# v0.2.101

- 修复直连 QEMU 对 `-m size=...` 内存参数的解析。
- 采集 QEMU `-blockdev` 文件磁盘，并过滤 seed、ISO 和固件设备。
