# Agent Delivery Matrix

The root `VERSION` file is the release version for every agent, desktop client,
server, web application, and shared package.

在明确要求“发布正式版 release”之前，任何“发布 release”的要求均表示
测试版 release。测试版只能用于测试，不能视为稳定生产版本。版本号在明确
允许前只能递增第三位，第一位和第二位不得增加。

## Supported Deliveries

| Delivery | Platform | Entry point | Lifecycle |
| --- | --- | --- | --- |
| Desktop product | Windows | `DeviceStateConsole-Windows-Setup-vX.Y.Z.exe` | Installs the tray application, the `guanlan-agent` machine-scope service and the collector. Supports `/S` plus `/HUB= /KEY= /DEVICE= /HOSTNAME= /SERVICE= /VERIFY=` for unattended installs. |
| Desktop product | Linux | `DeviceStateConsole-Linux-Install-vX.Y.Z.deb` | Installs the Electron application and enables `guanlan-agent.service` (system unit). Supports unattended configuration through `GUANLAN_*` variables or `guanlan-agent config set`. |
| Portable | Windows | `DeviceStateConsole-Windows-Portable-vX.Y.Z.zip` | Unpacked desktop application that spawns its own backend; no service is installed. |
| Portable / headless | Linux | Collector binary inside the Debian package | Can be run directly under any supervisor with `DSC_SERVER_URL`, `DSC_AGENT_SECRET`, `DSC_DEVICE_ID`, `DSC_HOSTNAME`. |

Android release APKs use `deploy/package-android-release.ps1` and are named
`DeviceStateConsole-Android-vX.Y.Z.apk`.

There is no separate CLI distribution. `main.go` remains the cross-platform
collector, and the desktop package ships `guanlan-agent` (the local control
backend) which provides every headless capability the retired `dsc` tool had:
`status`, `doctor`, `config get|set|validate|export|import`, `service
install|uninstall|start|stop|status`, `collector start|stop|restart`, `probes
status|detect`, `wait-for-upload`, and `onboarding-url`.

### Local configuration contract

The machine-scope service persists `agent-ui.config.json` in the machine
configuration directory: `%ProgramData%\Guanlan` on Windows and `/etc/guanlan`
on Linux. Override it with `GUANLAN_CONFIG_ROOT` (the retired
`DSC_CLI_CONFIG_ROOT` is still honoured). A desktop process that was spawned
with an explicit `--config-root` keeps using that directory, which is how the
portable build stays self-contained.

The JSON contract is shared by every consumer and includes `connection`,
`sampling`, `enabledMetrics`, `enabledDeviceIds`, `instanceMetricConfig`,
`probeSelections`, `cloudSyncEnabled`, `dataRecordingEnabled`,
`autoStartCollector`, and `autoRestartCollector`.

Use `guanlan-agent config validate|import|export` for unattended configuration.
Export always clears the connection secret, and the access key is accepted only
through `--key-stdin` or `--key-file`, never as a command-line value. Import
preserves the current secret when the imported file contains an empty or
redacted value. An omitted `enabledMetrics` field keeps the all-metrics
default, while an explicit empty array disables every metric. The desktop
settings page exposes the same connection, sampling/runtime, metric, probe,
instance, and cloud-push controls.

After installation, run the bundled binary's update command from an elevated
terminal. It checks `/api/updates`, accepts only a strictly newer release,
verifies the release SHA-256, replaces only the executable, preserves
configuration, and rolls back if the Linux service does not become active. When
the collector runs as a child of the machine-scope service it replaces its own
binary and exits, and the service restarts it; it never stops the service
manager from the inside:

```text
device-state-console-agent update
```

The command reads `DSC_SERVER_URL` and `DSC_AGENT_SECRET` (or the installed
Linux/Windows `agent.env`). Use `--server-url`, `--secret`, or `--install-dir`
when the installed environment is not available.

The Linux desktop package is named
`DeviceStateConsole-Linux-Install-vX.Y.Z.deb`; it is built and installed by
GitHub Actions on Ubuntu 24.04. The desktop package is the recommended Linux desktop
delivery, while the collector inside remains the portable/headless option.
`node-agent.mjs` and `dev-machine-agent-launcher.ps1` are retained only for
historical development-machine compatibility and are not part of release
packages or recommended deployment paths.
