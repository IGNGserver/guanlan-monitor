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

数据覆盖边界：

| Platform | Host/platform data | VM data | Guest Agent/Tools dependency |
| --- | --- | --- | --- |
| Proxmox VE | Node CPU、CPU 使用率、内存已用/可用、存储容量/已用/可用、节点及 VM 磁盘和网络累计计数 | VM 状态、vCPU、内存、磁盘配置、NIC/MAC/桥接/VLAN | 平台级数据不需要 QEMU Guest Agent；guest IP/文件系统等 guest 级数据另需 agent（当前适配层不强制） |
| KVM + libvirt | Node CPU/CPU 使用率、内存容量、存储池容量/已用 | Domain 状态、CPU/内存、磁盘/NIC、libvirt domain stats | guest hostname/IP 依赖 libvirt guest agent；平台配置采集不依赖它 |
| QEMU process | 当前仅能从本机普通采集器获得完整宿主机指标，虚拟化节点快照补充宿主机逻辑 CPU 数 | 运行中 QEMU 进程、vCPU、内存、命令行磁盘/NIC，镜像容量/实际占用由 `qemu-img` 补充 | 不需要 guest agent；进程模式不提供 guest IP/文件系统 |
| Hyper-V | Windows 主机 CPU、内存、逻辑磁盘、网络累计计数 | VM 状态、vCPU/CPU 使用率、启动/已分配/需求内存、VHD 容量/文件大小、虚拟交换机和 MAC | 不需要 guest agent；guest 内部指标不属于当前平台适配层 |
| VirtualBox | 当前虚拟化快照补充宿主机逻辑 CPU 数，完整宿主机指标仍来自普通 agent 采集器 | VM 状态、vCPU、内存、虚拟磁盘容量/占用、NIC/MAC/网络模式、Guest Properties | Guest Additions 只影响 Guest Properties；VM 配置和设备数据不依赖它 |
| VMware Workstation / Fusion | 当前虚拟化快照补充宿主机逻辑 CPU 数，完整宿主机指标仍来自普通 agent 采集器 | `vmrun` 运行/注册清单、VMX vCPU/内存、VMDK/磁盘配置、NIC/MAC/网络配置 | VMware Tools 只影响 `getGuestIPAddress`；VMX 配置采集不依赖它 |
| VMware vSphere | ESXi host CPU/内存清单、vCenter host 状态、datastore 容量/可用空间 | VM 状态、vCPU、内存、虚拟磁盘容量、NIC/MAC/端口组 | vCenter REST 配置数据不依赖 guest agent；guest 内部 IP/文件系统需另接 vCenter guest API 或 guest agent |

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
