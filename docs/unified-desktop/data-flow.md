# Unified Desktop: data flow

```text
Electron main
  ├─ typed IPC ⇄ preload ⇄ React renderer
  ├─ loopback HTTP ⇄ Go desktop backend ⇄ Go collector
  │                                  └─ durable upload spool ⇄ Hub /api/agent/ingest
  └─ authenticated Hub HTTP client
                                     ├─ /api/auth/*
                                     ├─ /api/devices*
                                     ├─ /api/devices/:id/metrics
                                     └─ /api/devices/:id/traffic-calendar
```

## Local telemetry path

1. Main launches exactly one local backend and passes a per-run loopback port, the configuration root, and the Electron main PID.
2. The backend owns the collector child and reads the shared local JSON configuration.
3. The collector probes hardware, applies the existing three-level display/collection filter, and creates an immutable sampled payload with the original sample timestamp.
4. The collector sends the payload to Hub. If the request fails, it writes the payload to the bounded durable spool. On recovery it drains oldest-first before or alongside the new sample stream, preserving original timestamps and deduplicating by sample id.
5. Hub stores realtime state and minute/hour aggregates. The desktop refresh loop requests a normalized snapshot; the existing web clients may additionally consume `device:update`.

## Desktop read path

1. Renderer requests typed operations through preload only.
2. Main owns session/access-key handling and calls Hub APIs. It keeps the key in an OS-backed store when available and never returns it in a general state snapshot.
3. Main updates the renderer with normalized results and a `source` of `live`, `cache`, or `empty`, plus cache age metadata.
4. Main persists the redacted `DesktopSnapshot` in the desktop cache. Cache writes are atomic; cache misses degrade to an explicit empty state.
5. The renderer polls through the typed `refresh` method while the window is open and also supports a manual refresh action.

## Configuration path

Local settings are written through `IPC -> main -> local backend /api/config`. The backend remains the compatibility boundary for `AgentLocalConfig` and sets the cloud-sync dirty flag when display configuration changes. `IPC cloudPush` maps only to the backend's `/api/cloud/push`; it must not accept an arbitrary remote device id.

## Authority boundary

| Data / action | Authority | Desktop behavior |
| --- | --- | --- |
| Hardware capability and sampled metrics | Agent on that device | Read from Hub for all devices; configure only local Agent |
| Which metrics are collected/uploaded | Local Agent config | Edit local only |
| Which metrics Hub exposes for a device | Device config persisted by Hub/Agent sync | Read for all devices; never edit remotely |
| Fleet list/history | Hub | Read-only, cacheable |
| Fan sensor note | Hub fan-note endpoint | Narrow explicit metadata write from device detail; no remote config editor |
| Global access key | User + OS-backed local secret store | Main-process only, redacted everywhere else |
