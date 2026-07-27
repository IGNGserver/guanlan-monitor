# Agent Delivery Matrix

The root `VERSION` file is the release version for every agent, desktop client,
server, web application, and shared package.

在明确要求“发布正式版 release”之前，任何“发布 release”的要求均表示
测试版 release。测试版只能用于测试，不能视为稳定生产版本。版本号在明确
允许前只能递增第三位，第一位和第二位不得增加。

## Supported Deliveries

| Delivery | Platform | Entry point | Lifecycle |
| --- | --- | --- | --- |
| CLI agent | Windows | `deploy/install-agent.ps1` | Install/upgrade/uninstall through a scheduled task or current-user startup fallback. |
| CLI agent | Linux | `deploy/install-agent.sh` | Install/upgrade/uninstall through `device-state-console-agent.service`. |
| Desktop agent | Windows | `deploy/build-windows-agent-portable.ps1` and `deploy/build-windows-agent-setup.ps1` | Portable bundle includes frontend, backend, collector, runtime, and hardware assets; setup supports install, update, repair, and uninstall. |

Android release APKs use `deploy/package-android-release.ps1` and are named
`DeviceStateConsole-Android-vX.Y.Z.apk`.

`main.go` is the only supported cross-platform CLI collector implementation.
Run `deploy/build-cli-agent.ps1 -Zip` to create
`DeviceStateConsole-Windows-CLI-Install-vX.Y.Z.zip` and
`DeviceStateConsole-Linux-CLI-Install-vX.Y.Z.zip`. Their installers use the bundled binary and do
not require Go on the target host.
`node-agent.mjs` and `dev-machine-agent-launcher.ps1` are retained only for
historical development-machine compatibility and are not part of release
packages or recommended deployment paths.
