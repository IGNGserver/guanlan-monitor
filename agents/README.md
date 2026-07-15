# Agent Delivery Matrix

The root `VERSION` file is the release version for every agent, desktop client,
server, web application, and shared package.

## Supported Deliveries

| Delivery | Platform | Entry point | Lifecycle |
| --- | --- | --- | --- |
| CLI agent | Windows | `deploy/install-agent.ps1` | Install/upgrade/uninstall through a scheduled task or current-user startup fallback. |
| CLI agent | Linux | `deploy/install-agent.sh` | Install/upgrade/uninstall through `device-state-console-agent.service`. |
| Desktop agent | Windows | `deploy/build-windows-agent-portable.ps1` and `deploy/build-windows-agent-setup.ps1` | Portable bundle includes frontend, backend, collector, runtime, and hardware assets; setup supports install, update, repair, and uninstall. |

`main.go` is the only supported cross-platform CLI collector implementation.
Run `deploy/build-cli-agent.ps1 -Zip` to create self-contained `windows-x64`
and `linux-x64` CLI packages. Their installers use the bundled binary and do
not require Go on the target host.
`node-agent.mjs` and `dev-machine-agent-launcher.ps1` are retained only for
historical development-machine compatibility and are not part of release
packages or recommended deployment paths.
