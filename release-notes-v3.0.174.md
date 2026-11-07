# Device State Console v3.0.174

## M3E device-group experience and device lifecycle

- Add Material 3 Expressive ripple/state layers, spring-based expand/collapse transitions and rotating chevrons to sidebar device groups and grouped device sections on desktop and touch layouts.
- Unify group health semantics across sidebar dots, overview/filter chips, group headers and peer navigation: healthy green, warning/partial-offline amber, critical red, and fully offline neutral gray.
- Increase the default Hub heartbeat grace period from 45 seconds to 120 seconds so one missed 30-second Agent report does not immediately flap a device offline; allow deployments to override it with `DSC_HEARTBEAT_TIMEOUT_MS`.
- Add direct “delete device from Hub” actions in the normal device directory, grouped device tables, desktop detail page and touch detail flow. Deleting remains a Hub-side soft close: an Agent that keeps running automatically re-registers on its next report.
- Allow browser DELETE requests through the Hub CORS policy.

## Validation

- Source and package versions are synchronized at 3.0.174.
- The tagged release workflow runs the full source, server, desktop, web, Agent, Android, packaging and visual validation gates.
