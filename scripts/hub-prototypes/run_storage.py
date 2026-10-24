"""CI-only standalone SQLite WAL measurements; not a language comparison."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import resource
import sqlite3
import subprocess
import sys
import tempfile
import time

# Even a refused invocation must not create __pycache__ in a NAS source checkout.
sys.dont_write_bytecode = True
from sqlite_wal import Store, require_local


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--count", default=256, type=int)
    parser.add_argument("--iterations", default=100, type=int)
    args = parser.parse_args()
    if os.environ.get("CI") != "true" or not os.environ.get("RUNNER_TEMP"):
        parser.error("benchmark requires CI=true and local RUNNER_TEMP; do not run locally")
    root = Path(os.environ["RUNNER_TEMP"]).resolve()
    output = args.out.resolve()
    if not output.is_relative_to(root) or args.iterations < 1:
        parser.error("output must be under RUNNER_TEMP; iterations must be positive")
    require_local(root / "filesystem-probe")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="hub-sqlite-", dir=root) as temporary:
        work = Path(temporary)
        batch = work / "batch.json"
        subprocess.run(["node", str(Path(__file__).with_name("generate.mjs")), str(batch), str(args.count)], check=True)
        raw = batch.read_bytes()
        latencies = []
        with Store(work / "telemetry.db") as store:
            # Cold insert measured separately from repeated unique-key replacement.
            start = time.perf_counter_ns()
            first_ack = store.ingest(raw)
            cold_ms = (time.perf_counter_ns() - start) / 1e6
            before = resource.getrusage(resource.RUSAGE_SELF)
            start = time.perf_counter_ns()
            for _ in range(args.iterations):
                tick = time.perf_counter_ns()
                ack = store.ingest(raw)
                latencies.append((time.perf_counter_ns() - tick) / 1e6)
                if ack != first_ack:
                    raise RuntimeError("replay changed acknowledgement/unique rows")
            wall_ms = (time.perf_counter_ns() - start) / 1e6
            after = resource.getrusage(resource.RUSAGE_SELF)
            persisted = json.dumps(store.payloads(), sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
            digest = hashlib.sha256(persisted).hexdigest()
            rows = store.count()
            if store.connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise RuntimeError("integrity check failed")
            database_bytes = sum(file.stat().st_size for file in work.glob("telemetry.db*"))
        latencies.sort()
        report = {"status": "research-only", "productionReplacementAuthorized": False,
                  "versions": {"python": platform.python_version(), "sqlite": sqlite3.sqlite_version, "platform": platform.platform()},
                  "persistedSha256": digest, "measurements": {
                      "iterations": args.iterations, "inputBytes": len(raw), "uniqueRows": rows, "databaseAndWalBytes": database_bytes,
                      "coldInsertBatchMs": cold_ms, "replayWallMs": wall_ms,
                      "cpuUserMs": (after.ru_utime - before.ru_utime) * 1000,
                      "cpuSystemMs": (after.ru_stime - before.ru_stime) * 1000,
                      "peakRssBytes": after.ru_maxrss * (1 if sys_platform_is_macos() else 1024),
                      "p50ReplayBatchMs": latencies[(args.iterations * 50 + 99) // 100 - 1],
                      "p95ReplayBatchMs": latencies[(args.iterations * 95 + 99) // 100 - 1]}}
        output.write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report))


def sys_platform_is_macos():
    return platform.system() == "Darwin"


if __name__ == "__main__":
    main()
