# Unified Desktop: feature inventory

This inventory describes behavior, not old visual structure. The source of truth for the detailed data fields is `packages/shared/src/index.ts`, the Go payload structs, and the Hub routes.

## Fleet and read-only device viewing

- Authenticate with the global Hub access key.
- Show all known devices, including devices that are currently offline but have retained history.
- Filter/search devices by hostname or device id.
- Show OS, agent version/channel, online/offline state, last-seen timestamp, and the latest CPU/GPU/memory/disk summary values.
- Open a device detail view with the latest snapshot and historical windows `1m`, `15m`, `1d`, `1w`, `1mo`, and `1y`.
- Render only the metrics and hardware instances allowed by that device's `availableMetrics`, `enabledMetrics`, `enabledDeviceIds`, and `instanceMetricConfig` response.
- Show CPU packages, memory and swap, disks and disk health metadata, network interfaces and traffic, GPUs, fans, sensor backends, and system process/thread/handle counts when present.
- Show traffic calendar data by day/week/month.
- Subscribe to realtime updates; fall back to explicit stale/offline state when the Hub or socket is unavailable.
- Cache device list, latest state, metric config, and recently opened histories for offline viewing, with an explicit cached-data badge and last successful refresh time.
- Never render configuration-edit controls for remote devices.

## This-device configuration

- Edit Hub URL, global access key, device id, and hostname for the local Agent.
- Configure normal and slow sampling intervals.
- Enable/disable local data recording and cloud display-config sync.
- Start, stop, and inspect the local collector.
- Check Hub connection and distinguish unreachable, unauthorized, device-not-known, and successful responses.
- Detect local CPU, disk, network, GPU, and fan probe targets and show detected instances.
- Choose the provider and enabled state per probe target.
- Enable/disable metrics by block and by individual metric.
- Enable/disable detected instances by block.
- Override metrics per detected instance without erasing global settings.
- Explicitly push the local display configuration to Hub and show pending/success/failure state.
- Configure auto-start, auto-restart, and start-minimized behavior for the complete tray application.

## Diagnostics and delivery

- Show local backend/collector state, last upload, restart count, last issue category/detail, pending cloud sync, configuration paths, and diagnostic log location.
- Offer redacted diagnostics export suitable for support; never export the access key.
- Show update channel/version and use the existing update API semantics.
- Single-instance activation: a second launch focuses the existing window.
- Tray menu: Open and Exit. Closing the window hides it; Exit performs the full drain and process shutdown.

## Required state variants

Every primary page and data section must have intentional loading, empty, error, offline, cached, permission/unauthorized, and partial-data states. A stale cached value must not be labeled online or realtime.
