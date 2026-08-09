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
| Desktop agent | Linux (GNOME) | `deploy/build-linux-agent-gui.sh` | GTK4/libadwaita native configuration UI, WebKitGTK Hub view, Go backend/collector, and Debian `amd64` install package. |

Android release APKs use `deploy/package-android-release.ps1` and are named
`DeviceStateConsole-Android-vX.Y.Z.apk`.

`main.go` is the only supported cross-platform CLI collector implementation.
Run `deploy/build-cli-agent.ps1 -Zip` to create
`DeviceStateConsole-Windows-CLI-Install-vX.Y.Z.zip` and
`DeviceStateConsole-Linux-CLI-Install-vX.Y.Z.zip`. Their installers use the bundled binary and do
not require Go on the target host.

After installation, run the bundled binary's update command from an elevated
terminal. It checks `/api/updates`, accepts only a strictly newer release,
verifies the release SHA-256, stops the service/task, replaces only the
executable, preserves configuration, and rolls back if the Linux service does
not become active:

```text
device-state-console-agent update
```

The command reads `DSC_SERVER_URL` and `DSC_AGENT_SECRET` (or the installed
Linux/Windows `agent.env`). Use `--server-url`, `--secret`, or `--install-dir`
when the installed environment is not available.

## Hypervisor adapters

The collector can optionally append platform-level virtualization telemetry to
the normal host payload. The adapter is disabled unless
`DSC_VIRTUALIZATION_ENABLED=true` or a platform/endpoint is configured. Keep
platform credentials in the service environment rather than the repository or
the JSON config file. The adapters use the following host-side interfaces:

| Platform | Host interface | Collection path |
| --- | --- | --- |
| Proxmox VE | Proxmox REST API | Cluster/node/VM/storage inventory and VM config |
| KVM + libvirt | `virsh` and libvirt | Node stats, pools, domains, disks, NICs and guest-agent addresses |
| QEMU | `qemu-system-*` process command line | Running process inventory and declared CPU/memory/disk/network configuration |
| Hyper-V | Windows PowerShell Hyper-V cmdlets | Host and VM CPU/memory/VHD/NIC inventory |
| Oracle VirtualBox | `VBoxManage` | VM configuration, medium sizes, NICs and guest properties |
| VMware vSphere | vCenter REST API | ESXi host, datastore and VM inventory/configuration |
| VMware Workstation / Fusion | `vmrun` plus local `.vmx` files | Registered/running VMs and VMX CPU/memory/disk/NIC configuration |

Direct QEMU processes do not expose the same storage/network counters as
libvirt; those fields remain absent unless the process command line or an image
tool exposes them. vSphere and macOS/Fusion require their vendor host and
credentials outside the PVE test cluster.

The Proxmox adapter uses:

```text
DSC_VIRTUALIZATION_ENABLED=true
DSC_VIRTUALIZATION_PLATFORM=proxmox
DSC_VIRTUALIZATION_ENDPOINT=https://pve.example:8006/api2/json
DSC_VIRTUALIZATION_NODE=pve1
DSC_VIRTUALIZATION_INSECURE_TLS=false
DSC_VIRTUALIZATION_POLL_SECONDS=30
DSC_VIRTUALIZATION_TOKEN_ID=root@pam!readonly
DSC_VIRTUALIZATION_TOKEN_SECRET=replace-with-a-short-lived-token-secret
```

The same non-secret settings may be placed in the Agent JSON configuration
under `virtualization`. The token ID and secret remain environment-only. A
platform adapter reports an explicit capability/error record when a provider
does not expose a requested VM or guest-level metric; it does not require a
vendor Guest Agent for the host/platform metrics.

Local adapter executable and vSphere credential settings are environment-only:

```text
DSC_VIRTUALIZATION_VIRSH=virsh
DSC_VIRTUALIZATION_LIBVIRT_URI=qemu:///system
DSC_VIRTUALIZATION_QEMU_IMG=qemu-img
DSC_VIRTUALIZATION_VBOXMANAGE=VBoxManage
DSC_VIRTUALIZATION_VMRUN=vmrun
DSC_VIRTUALIZATION_VM_PATHS=/path/to/one.vmx;/path/to/two.vmx
DSC_VSPHERE_USERNAME=
DSC_VSPHERE_PASSWORD=
DSC_VSPHERE_TOKEN=
```

The Linux GUI package is named
`DeviceStateConsole-Linux-GUI-Install-vX.Y.Z.deb`; it is built and installed by
GitHub Actions on Ubuntu 24.04. The GUI package is the recommended Linux desktop
delivery for GNOME, while the CLI package remains the portable/headless option.
`node-agent.mjs` and `dev-machine-agent-launcher.ps1` are retained only for
historical development-machine compatibility and are not part of release
packages or recommended deployment paths.
