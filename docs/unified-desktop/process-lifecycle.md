# Unified Desktop: process lifecycle

## Start

1. Acquire the Electron single-instance lock.
2. If another instance exists, send it an activation message and focus/show the existing window; do not start another backend or collector.
3. Initialize the controller/tray and migrate config before creating the main window.
4. The first snapshot request starts the local backend, waits for its state endpoint, attaches the Electron main PID, then renders local state.
5. The backend starts the collector only when local recording is enabled and the user/startup policy requests it.

## Window close

`window-all-closed` is intercepted. The main process hides the window and leaves tray, backend, and collector alive. No collector shutdown is triggered.

## Tray

The tray menu contains `打开` and `退出`. A tray click or a second app launch calls the same activation path. Linux tray behavior is an enhancement only; single-instance activation remains the recovery path.

## Collector crash

The backend marks the collector as exited, applies bounded exponential restart (maximum attempts/window), exposes the recovery state, and emits a redacted diagnostic. Renderer reload/crash does not stop the backend because the backend watches Electron main, not the renderer.

## Exit state machine

```text
RUNNING
  -> STOP_REQUESTED (tray Exit)
  -> DRAINING (stop new samples; finish or persist current payload)
  -> PERSISTED (flush durable spool and config/sync state)
  -> CHILD_STOPPED (collector receives interrupt and exits)
  -> BACKEND_STOPPED (backend HTTP server closes)
  -> APP_QUIT
```

Each phase has a deadline. Only after the overall deadline is exceeded may main terminate the backend process tree. Shutdown is idempotent and uses the same path for Windows and Linux. The backend job object/child process group is the final orphan-prevention guard.

## Startup policy

The OS startup entry launches the full Electron tray application with a start-minimized argument. It does not install Windows Service or systemd service. Uninstall terminates the app/backend/collector and preserves configuration unless the user explicitly chooses removal.
