# Device State Console v3.0.173

## Device groups consistency hardening

- Fix Android group clearing and dissolve requests so `group: null` is preserved on the wire.
- Serialize group mutations on Android and reconcile from the Hub after writes and failures.
- Normalize group names consistently with Unicode NFC, whitespace trimming and the 64-character contract.
- Reject reserved filter sentinel names (`all`, `__all__`, `__ungrouped__`) and migrate legacy values to ungrouped state.
- Fix filtered group management so rename, dissolve and batch membership actions operate on the complete intended device set.
- Keep overview, touch navigation and deep-link group filters in sync across Web/Desktop.
- Serialize registry mutations and device events to prevent ingest/offline races from restoring stale group membership.
- Make realtime broadcasts best-effort so a notification failure does not turn a committed mutation into a false failure.
- Align Android and Web group health thresholds and counts.
- Include group information in the iOS device summary/detail read model and device list.

## Validation

- Type checks, workspace contracts, adapter contracts, UI helpers, boundary checks and version verification pass in CI.
- Android, server query regression and native validation workflows are run by GitHub Actions for the tagged release.
