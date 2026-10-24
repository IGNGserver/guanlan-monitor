"""CI-only language experiment. No SQLite import, connection or storage swap."""

import argparse
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import tempfile


HERE = Path(__file__).resolve().parent


def command(*args, **kwargs):
    return subprocess.check_output([str(arg) for arg in args], text=True, **kwargs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--count", default=256, type=int)
    parser.add_argument("--iterations", default=100, type=int)
    parser.add_argument("--rounds", default=5, type=int)
    args = parser.parse_args()
    if os.environ.get("CI") != "true" or not os.environ.get("RUNNER_TEMP"):
        parser.error("benchmark requires CI=true and a local RUNNER_TEMP; do not run locally")
    runner = Path(os.environ["RUNNER_TEMP"]).resolve()
    output = args.out.resolve()
    if not output.is_relative_to(runner) or min(args.iterations, args.rounds) < 1:
        parser.error("output must be under RUNNER_TEMP; rounds/iterations must be positive")
    # Linux CI only, refuse NAS and unknown filesystems without coupling to the storage prototype.
    mounts = [line.split() for line in Path("/proc/mounts").read_text().splitlines()]
    def mount_path(text):
        return Path(re.sub(r"\\([0-7]{3})", lambda match: chr(int(match[1], 8)), text))

    matches = [(mount_path(row[1]), row[2]) for row in mounts if len(row) >= 3 and runner.is_relative_to(mount_path(row[1]))]
    filesystem = max(matches, key=lambda row: len(row[0].parts))[1] if matches else "unknown"
    if filesystem not in {"ext4", "xfs", "btrfs", "overlay", "zfs"}:
        parser.error(f"refuse benchmark filesystem {filesystem}")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="hub-language-", dir=runner) as temporary:
        work = Path(temporary)
        shutil.copytree(HERE / "go", work / "go")
        (work / "gotmp").mkdir()
        batch = work / "batch.json"
        command("node", HERE / "generate.mjs", batch, args.count)
        env = {**os.environ, "GOCACHE": str(runner / "hub-prototype-gocache"), "GOMODCACHE": str(runner / "hub-prototype-gomodcache"),
               "GOTMPDIR": str(work / "gotmp"), "GOTOOLCHAIN": "local"}
        binary = work / "ingest"
        command("go", "build", "-o", binary, ".", cwd=work / "go", env=env)
        commands = {"node": ["node", HERE / "language.mjs"], "go": [binary]}
        # Independent, untimed semantic golden check, in addition to matching digests.
        golden = {name: json.loads(command(*cmd, batch)) for name, cmd in commands.items()}
        if golden["node"] != golden["go"]:
            raise RuntimeError("Node/Go semantic or canonical golden mismatch")
        samples = {name: [] for name in commands}
        for round_index in range(args.rounds):
            order = ["node", "go"] if round_index % 2 == 0 else ["go", "node"]
            for name in order:
                sample = json.loads(command(*commands[name], batch, args.iterations))
                if sample["canonicalSha256"] != golden[name]["canonicalSha256"]:
                    raise RuntimeError("benchmark output changed from golden")
                samples[name].append(sample["measurements"])
        report = {
            "status": "research-only", "productionReplacementAuthorized": False,
            "versions": {"node": command("node", "--version").strip(), "go": command("go", "version").strip(),
                         "python": platform.python_version(), "platform": platform.platform(), "logicalCpuCount": os.cpu_count()},
            "canonicalSha256": golden["node"]["canonicalSha256"], "samples": samples
        }
        output.write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report))


if __name__ == "__main__":
    main()
