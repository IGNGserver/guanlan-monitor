"""Independent research store: raw JSON only, not a Hub repository implementation."""

import argparse
from contextlib import closing
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import signal
import sqlite3
import subprocess
import sys


LOCAL_FILESYSTEMS = {"ext2", "ext3", "ext4", "xfs", "btrfs", "zfs", "overlay", "apfs", "hfs"}


def _unescape_mount(text):
    return re.sub(r"\\([0-7]{3})", lambda match: chr(int(match[1], 8)), text)


def mounted_filesystems():
    if sys.platform.startswith("linux"):
        # /proc/mounts escapes whitespace; longest mount-point match handles nested mounts.
        rows = Path("/proc/mounts").read_text().splitlines()
        return [(_unescape_mount(parts[1]), parts[2]) for line in rows if len(parts := line.split()) >= 3]
    if sys.platform == "darwin":
        rows = subprocess.check_output(["/sbin/mount"], text=True).splitlines()
        mounts = []
        for row in rows:
            match = re.match(r"^.+ on (.+) \(([^, )]+)(?:[, )])", row)
            if match:
                mounts.append((match[1], match[2]))
        return mounts
    raise RuntimeError("unsupported filesystem inspection: refuse database writes")


def require_local(path, mounts=None):
    """Fail closed. Resolve symlinks first; never trust CI=true as a safety bypass."""
    resolved = Path(path).expanduser().resolve()
    matches = [(Path(root), fs) for root, fs in (mounted_filesystems() if mounts is None else mounts)
               if resolved.is_relative_to(Path(root))]
    if not matches:
        raise RuntimeError("cannot determine filesystem: refuse database writes")
    root, filesystem = max(matches, key=lambda row: len(row[0].parts))
    if filesystem.lower() not in LOCAL_FILESYSTEMS:
        raise RuntimeError(f"refuse non-local/unknown filesystem {filesystem} at {root}")
    if not resolved.parent.is_dir():
        raise RuntimeError("database parent must already exist on verified local filesystem")
    return resolved


def _reject_constant(value):
    raise ValueError(f"non-JSON numeric constant: {value}")


def validate_numbers(value):
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if not -9007199254740991 <= value <= 9007199254740991:
            raise ValueError("prototype only supports safe-number range")
    elif isinstance(value, list):
        for child in value:
            validate_numbers(child)
    elif isinstance(value, dict):
        for child in value.values():
            validate_numbers(child)


def parse_batch(raw):
    batch = json.loads(raw, parse_constant=_reject_constant)
    if not isinstance(batch, list):
        raise ValueError("batch must be an array")
    validate_numbers(batch)
    return batch


def key_for(payload):
    if not isinstance(payload, dict) or not isinstance(payload.get("identity"), dict):
        raise ValueError("invalid payload identity")
    device, timestamp = payload["identity"].get("deviceId"), payload.get("timestamp")
    if not isinstance(device, str) or not device or not isinstance(timestamp, str):
        raise ValueError("invalid identity/timestamp")
    if not re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", timestamp):
        raise ValueError("timestamp must be canonical UTC milliseconds")
    parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    if parsed.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z") != timestamp:
        raise ValueError("invalid timestamp")
    return device, timestamp


class Store:
    def __init__(self, path):
        self.path = require_local(path)
        self.connection = sqlite3.connect(self.path, isolation_level=None, timeout=5)
        try:
            mode = self.connection.execute("PRAGMA journal_mode=WAL").fetchone()[0]
            if mode.lower() != "wal":
                raise RuntimeError("WAL unavailable")
            self.connection.execute("PRAGMA synchronous=FULL")
            self.connection.execute("PRAGMA busy_timeout=5000")
            self.connection.execute("""CREATE TABLE IF NOT EXISTS telemetry (
                device TEXT NOT NULL, timestamp TEXT NOT NULL, raw_json TEXT NOT NULL,
                PRIMARY KEY (device, timestamp)) WITHOUT ROWID""")
        except BaseException:
            self.connection.close()
            raise

    def close(self):
        self.connection.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def ingest(self, raw, before_commit=None):
        batch = parse_batch(raw)
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            for payload in batch:
                device, timestamp = key_for(payload)
                encoded = json.dumps(payload, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
                self.connection.execute("""INSERT INTO telemetry VALUES (?, ?, ?)
                    ON CONFLICT(device, timestamp) DO UPDATE SET raw_json=excluded.raw_json""",
                    (device, timestamp, encoded))
            if before_commit is not None:
                before_commit()  # Fault injection for crash tests; no acknowledgement here.
            self.connection.execute("COMMIT")
        except BaseException:
            if self.connection.in_transaction:
                self.connection.execute("ROLLBACK")
            raise
        # Acknowledgement is constructed only after the FULL synchronous commit succeeds.
        return {"acknowledged": len(batch), "rows": self.count()}

    def count(self):
        return self.connection.execute("SELECT count(*) FROM telemetry").fetchone()[0]

    def payloads(self):
        return [json.loads(row[0]) for row in self.connection.execute(
            "SELECT raw_json FROM telemetry ORDER BY device, timestamp")]

    def backup(self, destination):
        destination = require_local(destination)
        if destination.exists():
            raise FileExistsError("backup is immutable: select a new destination")
        with closing(sqlite3.connect(destination)) as target:
            self.connection.backup(target)

    def restore(self, backup):
        """Explicit test rollback to a snapshot. No clients may use this store concurrently."""
        backup = require_local(backup)
        if backup == self.path or not backup.is_file():
            raise ValueError("restore requires a separate existing backup")
        with closing(sqlite3.connect(backup.as_uri() + "?mode=ro", uri=True)) as source:
            if source.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise RuntimeError("backup integrity check failed")
            source.backup(self.connection)


def pause_for_kill():
    print("READY_TO_KILL", file=sys.stderr, flush=True)
    signal.pause()
    raise RuntimeError("fault pause unexpectedly resumed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--fault", choices=["before-commit", "after-commit"], help="test-only SIGKILL barrier")
    args = parser.parse_args()
    raw = Path(args.input).read_bytes()
    with Store(args.db) as store:
        ack = store.ingest(raw, pause_for_kill if args.fault == "before-commit" else None)
        if args.fault == "after-commit":
            pause_for_kill()  # Crash window: durable write, lost acknowledgement; replay must be safe.
        print(json.dumps(ack), flush=True)


if __name__ == "__main__":
    main()
