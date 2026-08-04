# Unified Desktop: migration plan

## Phase 1: preserve and audit

- Keep WinUI, GTK, Web, Agent, and existing package scripts intact.
- Add the unified desktop workspace and new shared contracts without changing Hub page structure.
- Capture configuration paths and migrate compatible `agent-ui.config.json` fields rather than silently overwriting them.

## Phase 2: add the Electron shell

- Add an Electron main process with single-instance lock, tray, window hide/show, startup registration, and platform-neutral lifecycle state.
- Add a preload bridge with explicit typed methods only.
- Launch the existing Go backend/collector bundle from the packaged `resources` directory and pass the Electron main PID.
- Use a per-run loopback port and a local IPC token so the renderer cannot directly control the backend.

## Phase 3: add the clean-room renderer

- Gemini via the verified `agy` integration owns the new React/TypeScript renderer, design system, feature pages, charts, tests, and screenshot iterations.
- The renderer consumes the shared contracts and live/cache/empty bridge states; it never fabricates telemetry and never imports old XAML/GTK/Web DOM or CSS.
- Keep fleet read access and local configuration clearly separated in navigation and types.

## Phase 4: reliability and cache

- Add bounded Agent upload spool with atomic recovery, oldest-first replay, duplicate protection, age/size limits, and status reporting.
- Add bounded desktop read cache with source markers and last-live timestamps.
- Add graceful drain: stop new samples, flush spool, persist state, close database/connections, then exit; force-kill only after timeout.

## Phase 5: packaging and cutover

- Replace the old GUI asset jobs with Electron Windows and Linux packages while leaving legacy package jobs available until parity is accepted.
- Do not install Windows Service or systemd service for the new desktop app.
- Verify Windows setup/portable assets and the Linux Debian package on CI runners; explicitly leave real-distro manual Linux testing to the user.

## Rollback

The old WinUI and GTK assets remain available while the Electron asset is validated. Configuration migration is additive and never overwrites the legacy file. If the new shell fails to start, the installer must not remove the legacy configuration or the existing Agent binary.
