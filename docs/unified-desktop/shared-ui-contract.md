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

The implementation is intentionally split by responsibility:

- `workspace/ui.tsx` and `workspace/formatters.tsx` contain reusable presentation
  primitives and display formatting.
- `workspace/TelemetryCards.tsx` owns the chart, trend, tooltip, and detail-card
  visualizations.
- `workspace/workspace.*.css` keeps tokens, shell, dashboard, telemetry, and
  responsive rules in cascade order; `workspace.css` is only the stable import
  entry used by both applications.

## Boundary rules

1. Web routes must enter through `UnifiedConsole` and render `WorkspaceApp`.
2. Legacy Web Dashboard/SaaS components are not production route entry points.
3. Desktop UI must keep using packaged local assets; it must not load the remote
   Web site as its renderer.
4. Web and desktop adapters may differ in authentication and transport, but the
   same snapshot fixture must render the same fleet/device state.

## Web archive boundary

The former Dashboard/SaaS component tree is preserved under
`apps/web/src/components/legacy/` for rollback and comparison only. It is
excluded from the Web TypeScript project and has no route import. The active Web
route graph is:

```text
apps/web/src/app/page.tsx
  -> UnifiedConsole
  -> WebConsoleAdapter + WorkspaceApp
```

The login form remains a Web-only authentication shell. Once authenticated, the
site renders the same `WorkspaceApp` used by Electron; it does not render the
archived dashboard.

## Verification gates

- `check:web-ui-boundary` verifies active routes and the legacy archive boundary.
- `check:desktop-ui-boundaries` rejects Web/Electron boundary leakage in shared UI.
- `check:adapter-contracts` and `test:adapter-contracts` cover adapter shape and
  the platform-neutral snapshot fixture.
- CI packages Electron and checks `resources/app.asar` against `VERSION`.
- CI runs both Web and real Electron renderer visual smoke tests at desktop and
  portrait widths, uploading screenshots and layout metrics as workflow evidence.
