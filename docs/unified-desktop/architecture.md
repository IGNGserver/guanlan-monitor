# Unified Desktop: target architecture

## Workspace

```text
apps/desktop/
  src/main/       Electron main, lifecycle, Hub client, cache, migration
  src/preload/    typed contextBridge only
  src/renderer/   Gemini-owned React/TypeScript UI
packages/shared/  existing Hub/Agent data contracts, extended additively
```

The renderer is a new implementation. It must not import `apps/web`,
`windows-agent`, or `linux-agent-gui` source files.

## Process model

- Main process: one instance; owns BrowserWindow, tray, OS startup registration, Hub session, cache, key store, local backend process, IPC handlers, and shutdown state.
- Preload: context-isolated bridge with no arbitrary channel or `ipcRenderer` exposure.
- Renderer: React UI only; no Node.js, filesystem, child-process, shell, or unrestricted network access.
- Local backend: the existing Go backend on a per-run loopback port with a per-run token, supervising the collector.
- Collector: the existing Go probe/HTTP uploader with signal-aware shutdown and durable upload spooling.

## Navigation boundary

The renderer has two top-level areas:

1. Fleet: overview, all devices, device detail, historical data, and traffic calendar. Telemetry and configuration are read-only; the existing narrow fan-note metadata action is the only explicit fleet-side write.
2. This computer: local status, sampling/probe/display configuration, Hub connection, diagnostics, and application/tray settings. Only these pages mutate local settings.

## IPC design principles

- Methods are capability-shaped (`getSnapshot`, `refresh`, `updateLocalConfig`, `controlAgent`, `setAgentSecret`, `login`, `logout`, `cloudPush`, `saveFanNote`, `updateStartupSettings`, `openExternal`, `exit`) rather than generic `invoke(channel, args)`.
- Main validates every argument before side effects and allowlists all IPC channels. Fan-note writes are a dedicated endpoint, not a generic remote configuration update.
- IPC responses never contain the plaintext Hub access key or Agent secret. A local config read returns `secretConfigured: boolean`; a controlled secret save accepts the new value only in the main process.

## Cache design

The desktop cache is an atomic versioned JSON snapshot under the platform user-data directory. It records `source`, `generatedAt`, session redaction state, fleet list, selected device, latest metrics, traffic calendar, and update metadata. Cache failures degrade to an explicit empty/offline state rather than showing fabricated telemetry.

## Migration

On first run, discover the legacy config root using packaged/portable heuristics and platform user-data paths. Copy supported local fields into the Electron user-data root. Preserve Hub URL, Agent secret, device id, hostname, sampling, probe, metric, instance, and cloud-sync settings. Never copy secret text into logs or diagnostics; the renderer only receives `secretConfigured`. If parsing fails, keep the original file and show an actionable migration error.

## Packaging

The packaged application includes Electron renderer/main/preload and the platform-matched Go backend/collector under `resources/agent`. Windows uses setup, portable ZIP, and update ZIP naming adapted to Electron. Linux uses a Debian package with a desktop entry and icon.

## Service model (revised)

The tray application is an optional control plane. The data plane is a
machine-scope service installed by the same package:

- Windows: a native service (`GuanlanAgent`, LocalSystem, auto start) installed
  by the NSIS installer; if service creation fails, the installer registers an
  `AtStartup` + SYSTEM scheduled task instead. The installer never falls back to
  a per-user `HKCU\...\Run` entry.
- Linux: a system-level `guanlan-agent.service` unit, enabled by the Debian
  package, running as a dedicated system user.

The service owns the machine-scope configuration
(`%ProgramData%\Guanlan\agent.json`, `/etc/guanlan/agent.json`), supervises the
collector, and exposes a token-protected loopback control API. The Electron main
process attaches to that service when it is running and only spawns its own
backend in portable/development mode. See
[HEADLESS_AGENT_SERVICE_PLAN.md](../HEADLESS_AGENT_SERVICE_PLAN.md).
