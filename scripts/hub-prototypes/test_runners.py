"""Exercise refusal paths only. These tests never execute a benchmark or build."""

import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


HERE = Path(__file__).resolve().parent


class RunnerSafetyTests(unittest.TestCase):
    def test_benchmarks_refuse_non_ci(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "not-created.json"
            for script in ["run_language.py", "run_storage.py"]:
                with self.subTest(script=script):
                    env = {key: value for key, value in os.environ.items() if key not in {"CI", "RUNNER_TEMP"}}
                    result = subprocess.run([sys.executable, str(HERE / script), "--out", str(output)],
                                            env=env, capture_output=True, text=True, timeout=10)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("requires CI=true", result.stderr)
                    self.assertFalse(output.exists())

    def test_benchmarks_refuse_output_outside_runner(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory).parent / "not-created-hub-report.json"
            for script in ["run_language.py", "run_storage.py"]:
                with self.subTest(script=script):
                    result = subprocess.run([sys.executable, str(HERE / script), "--out", str(output)],
                                            env={**os.environ, "CI": "true", "RUNNER_TEMP": directory},
                                            capture_output=True, text=True, timeout=10)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("output must be under RUNNER_TEMP", result.stderr)
                    self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
