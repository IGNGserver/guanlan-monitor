# 观澜 v3.0.85 测试版

## 移除虚拟机功能

- 移除 Agent 对 Hyper-V、Proxmox、libvirt、QEMU、VirtualBox、VMware 和 vSphere 的虚拟机清单与指标采集。
- 移除服务端虚拟机库存、合成设备、虚拟化存储池接口与数据模型；旧数据库、Redis 和桌面缓存会在升级时清理历史虚拟机数据。
- 移除 Web、Electron、Android 和 iOS 中的虚拟机筛选、宿主机关联和存储池展示。

本版本仅作为 GitHub prerelease 测试版发布，不更新 `latest`，不用于生产部署。
