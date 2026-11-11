# Device State Console v3.0.153

## 存储池采集（承载虚拟机的整块分区）

- 新增 `storagePools` 指标：采集承载虚拟机磁盘的整块存储——Proxmox 存储（`local-lvm` 等 LVM 精简池、目录存储、NFS/CIFS 共享、PBS 数据仓库）、LVM 精简池与逻辑卷、ZFS 池，以及包括网络共享在内的已挂载文件系统。
- 单个虚拟机的磁盘卷（`vm-*-disk-*`、快照、cloud-init）、loop 挂载的镜像、swap 与伪文件系统不会出现在列表中。
- Proxmox 源使用只读 API token（`DSC_STORAGE_PVE_*`，兼容既有的 `DSC_VIRTUALIZATION_*` 环境变量）；无 token 时 OS 源独立工作。两个来源按挂载路径与容量合并去重，Proxmox 条目优先，OS 观测补充挂载点、设备、卷组与所在磁盘。
- 设备详情"存储"页新增"虚拟机存储分区"分区：每个存储池一张容量仪表卡，半屏详情展示类型、卷组、精简池、所在磁盘与用途，并有一条全部启用存储池的使用率走势。

本版本仅作为 GitHub prerelease 测试版发布，不更新 `latest`，不用于生产部署。
