import copy
import json
from pathlib import Path
import select
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from sqlite_wal import Store, mounted_filesystems, require_local


HERE = Path(__file__).resolve().parent


class FilesystemTests(unittest.TestCase):
    def test_linux_mount_parser_unescapes_spaces(self):
        with patch("sqlite_wal.sys.platform", "linux"), patch("sqlite_wal.Path.read_text", return_value=(
                "root / ext4 rw 0 0\nserver /scratch\\040space nfs4 rw 0 0\n")):
            self.assertEqual(mounted_filesystems(), [("/", "ext4"), ("/scratch space", "nfs4")])

    def test_guard_rejects_network_unknown_and_symlink_escape(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            local = [("/", "ext4")]
            for fs in ["nfs", "nfs4", "cifs", "smbfs", "fuse.sshfs", "unknown", "tmpfs"]:
                with self.assertRaisesRegex(RuntimeError, "non-local/unknown"):
                    require_local(root / "db", local + [(str(root), fs)])
            self.assertEqual(require_local(root / "db", local), root / "db")
            with self.assertRaises(RuntimeError):
                require_local(root / "db", [])
            nested = root / "network"
            nested.mkdir()
            (root / "link").symlink_to(nested, target_is_directory=True)
            with self.assertRaises(RuntimeError):
                require_local(root / "link" / "db", local + [(str(nested), "nfs")])


class DurabilityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workspace = tempfile.TemporaryDirectory()
        cls.root = Path(cls.workspace.name)
        cls.fixture = cls.root / "batch.json"
        subprocess.run(["node", str(HERE / "generate.mjs"), str(cls.fixture), "8"], check=True, capture_output=True)
        cls.batch = json.loads(cls.fixture.read_text())

    @classmethod
    def tearDownClass(cls):
        cls.workspace.cleanup()

    def setUp(self):
        self.workspace = tempfile.TemporaryDirectory()
        self.root = Path(self.workspace.name)
        self.db = self.root / "telemetry.db"

    def tearDown(self):
        self.workspace.cleanup()

    def test_commit_ack_reopen_unique_replay_and_unknown_fields(self):
        raw = self.fixture.read_bytes()
        with Store(self.db) as store:
            self.assertEqual(store.connection.execute("PRAGMA synchronous").fetchone()[0], 2)
            self.assertEqual(store.ingest(raw), {"acknowledged": 9, "rows": 8})
            self.assertEqual(store.ingest(raw), {"acknowledged": 9, "rows": 8})
        with Store(self.db) as store:
            self.assertEqual(store.count(), 8)
            self.assertEqual(store.payloads()[0], self.batch[-1])
            self.assertEqual(store.connection.execute("PRAGMA integrity_check").fetchone()[0], "ok")

    def test_cli_ack_is_parseable_and_already_durable(self):
        output = subprocess.check_output([sys.executable, str(HERE / "sqlite_wal.py"),
                                          "--db", str(self.db), "--input", str(self.fixture)], text=True)
        self.assertEqual(json.loads(output), {"acknowledged": 9, "rows": 8})
        with Store(self.db) as store:
            self.assertEqual(store.count(), 8)
            self.assertEqual(store.payloads()[0], self.batch[-1])

    def test_invalid_json_and_unsafe_numbers_do_not_write(self):
        with Store(self.db) as store:
            for raw in ["{}", "invalid", "[NaN]", "[Infinity]", "[9007199254740992]", "[1e400]"]:
                with self.subTest(raw=raw), self.assertRaises(ValueError):
                    store.ingest(raw)
                self.assertEqual(store.count(), 0)

    def test_transaction_failure_and_commit_failure_never_ack_or_partially_persist(self):
        with Store(self.db) as store:
            store.ingest(self.fixture.read_bytes())
            original = store.payloads()
            changed = copy.deepcopy(self.batch[0])
            changed["cpuUsagePercent"] = 71
            with self.assertRaises(ValueError):
                store.ingest(json.dumps([changed, {"identity": {"deviceId": "bad"}, "timestamp": "invalid"}]))
            self.assertEqual(store.payloads(), original)

            # SQLite authorizer denies COMMIT, exercising the real commit exception path.
            def deny_commit(action, first, _second, _db, _trigger):
                if action == sqlite3.SQLITE_TRANSACTION and first == "COMMIT":
                    return sqlite3.SQLITE_DENY
                return sqlite3.SQLITE_OK

            store.connection.set_authorizer(deny_commit)
            with self.assertRaises(sqlite3.DatabaseError):
                store.ingest(json.dumps([changed]))
            store.connection.set_authorizer(None)
            self.assertEqual(store.payloads(), original)
            self.assertFalse(store.connection.in_transaction)

    def test_backup_restore_rollback_survives_reopen(self):
        backup = self.root / "immutable-snapshot.db"
        with Store(self.db) as store:
            store.ingest(self.fixture.read_bytes())
            original = store.payloads()
            store.backup(backup)
            with self.assertRaises(FileExistsError):
                store.backup(backup)
            changed = copy.deepcopy(self.batch[0])
            changed["cpuUsagePercent"] = 88
            store.ingest(json.dumps([changed]))
            self.assertNotEqual(store.payloads(), original)
            store.restore(backup)
            self.assertEqual(store.payloads(), original)
        with Store(self.db) as store:
            self.assertEqual(store.payloads(), original)

    def test_subprocess_kill_before_and_after_commit_then_recover_replay(self):
        for phase in ["before-commit", "after-commit"]:
            with self.subTest(phase=phase):
                db = self.root / f"{phase}.db"
                child = subprocess.Popen([sys.executable, str(HERE / "sqlite_wal.py"), "--db", str(db),
                                          "--input", str(self.fixture), "--fault", phase],
                                         stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                try:
                    ready, _, _ = select.select([child.stderr], [], [], 15)
                    self.assertTrue(ready, "child never reached crash barrier")
                    self.assertEqual(child.stderr.readline(), b"READY_TO_KILL\n")
                    self.assertGreater(Path(f"{db}-wal").stat().st_size, 0, "exercise a live WAL, not clean close")
                    child.kill()  # SIGKILL: no close(), destructor, finally or checkpoint cleanup.
                    stdout, _ = child.communicate(timeout=10)
                    self.assertEqual(stdout, b"", "crashed worker must not acknowledge")
                    self.assertLess(child.returncode, 0)
                finally:
                    if child.poll() is None:
                        child.kill()
                    child.communicate(timeout=10)
                with Store(db) as store:
                    self.assertEqual(store.count(), 0 if phase == "before-commit" else 8)
                    self.assertEqual(store.connection.execute("PRAGMA integrity_check").fetchone()[0], "ok")
                    self.assertEqual(store.ingest(self.fixture.read_bytes())["rows"], 8)
                    self.assertEqual(store.ingest(self.fixture.read_bytes())["rows"], 8)
                    self.assertEqual(store.payloads()[0], self.batch[-1])


if __name__ == "__main__":
    unittest.main()
