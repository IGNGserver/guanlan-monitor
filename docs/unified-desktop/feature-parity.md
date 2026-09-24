# Unified Desktop: feature parity matrix

Status values: `planned`, `implemented`, `verified`, `deferred`, `intentionally removed`, `blocked`.

| Capability | Old Windows WinUI | Old Linux GTK/WebKit | New Electron desktop | Status / note |
| --- | --- | --- | --- | --- |
| Single shared UI implementation | No | No | Yes | implemented; Gemini-owned clean-room React |
| Hub login with global key | Yes | Hub page login | Yes | implemented; key stays in main |
| Fleet device list | Yes | Via embedded Hub web | Yes | implemented; read-only native desktop page |
| Remote latest metrics | Yes | Via embedded Hub web | Yes | implemented |
| Remote historical metrics | Yes | Via embedded Hub web | Yes | implemented |
| Remote traffic calendar | Yes | Via embedded Hub web | Yes | implemented |
| Remote device configuration edit | Exposed through viewer-era APIs | Hub web could expose it | No | intentionally removed for desktop scope |
| Local URL/key/device identity | Yes | Yes | Yes | implemented; migrate existing JSON |
| Local sampling/recording settings | Yes | Yes | Yes | implemented |
| Probe provider/enable selection | Yes | Partial/native | Yes | implemented |
| Probe instance selection | Yes | Partial/native | Yes | implemented |
| Per-instance metric overrides | Yes | Partial/native | Yes | implemented |
| Explicit cloud display-config push | Yes | Backend path | Yes | implemented; local id only |
| Connection check | Yes | Yes | Yes | implemented |
| Diagnostics log/state | Yes | Yes | Yes | implemented, redacted |
| Agent auto-restart | Backend supported | Backend/service supported | Yes | implemented; bounded in main/backend |
| Window close hides to tray | No; close stops | Desktop/service-dependent | Yes | implemented |
| Tray Open/Exit | Windows native tray | Not reliable across desktops | Yes | implemented; Linux single-instance fallback |
| Agent upload spool | No | No | Yes | implemented; new durable collector feature |
| Desktop read cache with stale markers | No | No | Yes | implemented |
| Windows Service | No | N/A | No | intentionally removed |
| systemd service | N/A | Existing user unit | No | intentionally removed for new app |
| Android/iOS/Hub Web redesign | Out of scope | Out of scope | Out of scope | intentionally preserved |

No old functionality is silently dropped: remote configuration editing is explicitly prohibited by the new product boundary; system-service delivery is explicitly replaced by a tray application; old clients remain until functional parity and packaging acceptance are verified.
