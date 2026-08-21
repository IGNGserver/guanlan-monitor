# Shared UI and platform contract

## Current target

`packages/console-ui` is the only production UI implementation for the fleet
overview, device detail, history, traffic calendar, and settings navigation.

The two applications remain thin platform shells:

- `apps/desktop/` provides Electron main/preload, local Agent lifecycle,
  encrypted credential storage, cache, tray, and native window operations.
- `apps/web/` provides Next.js routing, HTTP-only session authentication,
  browser realtime transport, and responsive site hosting.

The shared UI must not import Electron, Next.js, `apps/web`, or local Agent
implementation files. It receives a transport through `ConsoleAdapter`.

## Port migration

The flat adapter remains the compatibility surface while the UI moves toward
smaller ports:

- `ConsoleReadPort`: snapshot reads and subscriptions.
- `ConsoleSessionPort`: login and session lifecycle.
- `ConsoleFleetPort`: Hub-backed fleet actions and widget layouts.
- `ConsoleLocalAgentPort`: desktop-only Agent configuration and control.

`ConsoleSnapshot` is the platform-neutral name for the shared read model.
`DesktopSnapshot` remains a type alias for IPC, cache, and existing integrations
until those names can be migrated without widening the desktop boundary.

## Boundary rules

1. Web routes must enter through `UnifiedConsole` and render `WorkspaceApp`.
2. Legacy Web Dashboard/SaaS components are not production route entry points.
3. Desktop UI must keep using packaged local assets; it must not load the remote
   Web site as its renderer.
4. Web and desktop adapters may differ in authentication and transport, but the
   same snapshot fixture must render the same fleet/device state.
