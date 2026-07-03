## Device State Console v0.1.2

### Highlights

- Redesign the device overview so each category is shown as a metric capsule and opens a half-screen detail panel with paged charts.
- Show GPU memory and disk capacity with current value plus total limit instead of percentage-only summaries.
- Keep `15m` and `1d` network and disk throughput views aggregated by average rate instead of totals.
- Unify Windows and Linux agent deployment around watchdog scripts with automatic restart and crash burst protection.
- Improve agent collection fallback behavior for Linux virtual machines and Windows hardware sensors.
- Fix Windows PowerShell UTF-8 output so Chinese network adapter names no longer render as mojibake.

### Included artifacts

- Signed Android release APK: `guanlan-android-v0.1.2.apk`

### Notes

- Signing material remains local-only and is not part of this release.
- This release continues to allow `http://` server addresses in the Android client for LAN deployments.
