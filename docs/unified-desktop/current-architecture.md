# Unified Desktop: current architecture

Audit baseline before the refactor: 2026-08-04, branch `refactor/unified-desktop`, source version `0.2.62`.

The resulting unified client is implemented in `apps/desktop/`; this file
records the legacy systems that were audited, not the new runtime topology.

## Scope discovered

- `agents/` contains the cross-platform Go collector. It reads a JSON config file, probes CPU/memory/disk/network/GPU/fan data, applies the configured metric and instance filters, and posts `AgentMetricsPayload` to `POST /api/agent/ingest` with the global `ACCESS_KEY` as a Bearer token.
- `agents/cmd/windows-agent-backend/` contains the local desktop backend. It owns the local JSON config, sync-state file, diagnostics log, probe detection, collector child process, auto-restart, and a loopback HTTP API on `127.0.0.1:17891`.
- `windows-agent/DeviceStateConsoleAgent.WinUI/` is the current Windows UI. It starts/attaches to the local backend, configures the collector, renders Hub devices and charts, and implements a Windows tray icon and single-instance mutex.
- `linux-agent-gui/` is a separate GTK4/libadwaita application. It owns a native configuration page, a WebKitGTK Hub page, a diagnostics page, and a user systemd unit fallback. This is the implementation that the new Electron client must replace for the desktop scope; it remains in the repository during migration.
- `apps/server/` is the Hub API and realtime service. Fastify serves authenticated device, metric, and widget-layout APIs, Redis/local JSON stores realtime state, MySQL/local JSON stores minute/hour history and widget layouts, and Socket.IO emits `device:update` events.
- `apps/web/` is the existing Hub web client. It is out of scope for visual migration and must not be embedded in the Electron renderer.

## Existing lifecycle behavior

The WinUI process starts the Go backend with its own PID. The backend watches that PID and owns the collector child. Closing the WinUI window currently stops the backend; the new Electron main process must instead hide the window and keep the backend/collector alive until the tray Exit action. The backend already has a Windows job object, parent-process watch, child auto-restart, and a graceful-shutdown endpoint, but the collector currently has no signal-aware drain phase.

## Existing Hub API surface

- Authentication: `POST /api/auth/login`, `GET /api/auth/session`, `POST /api/auth/logout`; the browser session is an HTTP-only cookie derived from the global access key.
- Read-only fleet: `GET /api/devices`, `GET /api/devices/:deviceId`, `GET /api/devices/:deviceId/metrics?window=...`, and `GET /api/devices/:deviceId/traffic-calendar`.
- Realtime: Socket.IO at `/socket.io`, event `device:update`.
- Agent integration: `POST /api/agent/ingest`, `GET /api/agent/ping`, `GET /api/agent/device-state`, and `POST /api/agent/device-config`, all using the same global key and optional HTTPS enforcement.
- Existing Hub metric-config writes (`PUT /api/devices/:deviceId/metric-config`) are web-oriented. The new desktop client must not expose that write path for remote devices; local writes go through the local Agent backend and only sync the local device.

## Existing storage and retention

- Local Hub fallback: `data/local-db.json` stores devices, realtime series, minute/hour history, fan notes, and metric configs behind a serialized write queue.
- MySQL: `device_minute_metrics` retains 90 days and `device_hourly_metrics` retains 370 days; instance data, recorded detail metadata, and `widget_layout_instances` / `widget_layout_templates` layouts are JSON columns. Widget layouts use MySQL whenever `MYSQL_URL` is configured and fall back to the persistent local JSON store otherwise.
- Redis: realtime device state and short `1m`/`15m` series.
- Desktop local files: `agent-ui.config.json`, `agent-ui.sync-state.json`, and `agent-ui.backend.log`, normally under the portable directory or the per-user application-data directory.
- At audit time there was no durable Agent upload spool; the refactor adds a bounded JSONL spool with state reporting and replay.

## Security baseline

The global key remains the only credential. The renderer must never receive Node.js access or an unrestricted plaintext key API. The new main process owns the authenticated Hub client and local backend client; preload exposes typed, least-privilege operations. Logs, diagnostics, and snapshots redact the key.

## Migration constraint

The old WinUI, GTK, and Hub web sources are evidence for feature inventory and protocol compatibility only. The new renderer is a new React/TypeScript implementation under the desktop workspace and must not import or copy old UI sources.
