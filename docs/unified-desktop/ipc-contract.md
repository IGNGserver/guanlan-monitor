# Unified Desktop: IPC contract

The renderer-facing contract is intentionally narrower than the internal main-process services.

## Requests

```ts
type DesktopApi = {
  getSnapshot(request?: DesktopSnapshotRequest): Promise<DesktopSnapshot>;
  refresh(request?: DesktopSnapshotRequest): Promise<DesktopSnapshot>;
  updateLocalConfig(patch: DesktopConfigPatch): Promise<DesktopSnapshot>;
  setAgentSecret(secret: string): Promise<DesktopSnapshot>;
  controlAgent(action: "start" | "stop" | "check-connection" | "detect-probes"): Promise<DesktopSnapshot>;
  login(accessKey: string): Promise<DesktopSnapshot>;
  logout(): Promise<DesktopSnapshot>;
  cloudPush(): Promise<DesktopSnapshot>;
  saveFanNote(deviceId: string, fanId: string, note: string): Promise<DesktopSnapshot>;
  updateStartupSettings(settings: { openAtLogin?: boolean; startMinimized?: boolean }): Promise<DesktopSnapshot>;
  openExternal(url: string): Promise<void>;
  exit(): Promise<void>;
  subscribe(listener: (snapshot: DesktopSnapshot) => void): () => void;
};
```

`DesktopSnapshot` includes `source: "live" | "cache" | "empty"`, cache age metadata, fleet/device metrics, traffic data, update metadata, startup settings, and a redacted local backend state. Metric windows include `5m`, `1h`, `6h`, `24h`, `7d`, `30d`, `90d`, and `1y` in addition to legacy aliases. Metric configuration writes are local config changes; remote devices remain read-only.

## Events

The preload exposes one allowlisted snapshot event. It is emitted after main-process refreshes and contains the same redacted `DesktopSnapshot` shape as request responses.

## Redaction rules

- Never serialize `AgentConnectionConfig.secret` to renderer state, logs, errors, or screenshots.
- A secret save request is handled in main and stored only in the backend config used by the collector; the acknowledgement contains `secretConfigured`, never the value.
- Hub access keys are kept in the main process and persisted through Electron `safeStorage` when available. The renderer receives only `accessKeyConfigured`.
- External URL opening is validated in main and only HTTP(S) URLs are accepted.
