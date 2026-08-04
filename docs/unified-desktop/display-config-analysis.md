# Unified Desktop: display configuration analysis

## Existing mechanism

The repository already has the required device-owned display mechanism; no second Manifest is needed.

### Local persistence

`agents/cmd/windows-agent-backend/main.go` persists `agentLocalConfig` to `agent-ui.config.json`. The relevant fields are:

- `enabledMetrics: string[]`
- `enabledDeviceIds: Record<block, string[]>`
- `instanceMetricConfig: Record<instanceId, string[]>`
- `probeSelections: { target, provider, enabled }[]`

The Go collector reads this same file through `DSC_AGENT_CONFIG_FILE`. Its `applyRuntimeConfig` function removes disabled blocks, filters selected instances, and removes disabled metric fields before upload. Empty `enabledMetrics` is treated as the backwards-compatible default of all known metric keys.

### Hub persistence and reads

The Hub uses `LocalDeviceMetricConfigStore` or the existing `MetricsService` abstraction to persist the same three display fields keyed by `deviceId`. `POST /api/agent/device-config` is the Agent-to-Hub sync path and is authenticated with the global key. `GET /api/devices/:deviceId/metrics` returns:

- `enabledMetrics`
- `enabledDeviceIds`
- `instanceMetricConfig`
- `availableMetrics`
- the latest state and a filtered historical `series`

`getAvailableMetrics` derives availability from the latest payload, including hardware-specific fields such as GPU and fan metrics. `timeSeriesToMetricSeries` then applies the same configuration to historical output. The existing web, WinUI, Android, and iOS clients use variants of these fields rather than a separate manifest.

## New desktop rule

The Electron desktop client consumes this existing contract unchanged wherever possible:

1. Remote device pages use only the read endpoints and the response's `availableMetrics`/configuration fields.
2. The renderer has no generic `saveDeviceConfig(deviceId)` method. The only write-shaped configuration operation is `saveLocalAgentConfig(config)` and it is routed to the local backend.
3. Pushing display configuration calls the local backend cloud-push endpoint, which derives the device id from the local config. A remote device id is never accepted by the IPC method.
4. If a missing field is discovered, add it to `@dsc/shared` and the corresponding Go type with an additive optional field; do not create a parallel manifest schema.

## Known gaps to address

- Historical server rows currently store a subset of detail data in JSON; the new client must treat absent fields as unavailable, not zero-valued online telemetry.
- Offline known devices synthesized from history use a default OS in the current route. The desktop client should display this as `unknown`/historical when the source does not provide an identity, instead of implying Windows.
- The current Hub `PUT /api/devices/:deviceId/metric-config` route can edit any device for an authenticated web session. The new desktop UI must not call it for remote devices; a future server-side authorization split is optional and must remain compatible with the existing web client.
