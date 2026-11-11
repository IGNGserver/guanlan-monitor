# v0.2.50 测试版

- 修复 Linux 挂载分区与磁盘 IO 计数器名称不一致导致磁盘读写速率为空的问题。
- 增加 Windows 磁盘型号、厂商、接口类型和完整网卡列表采集，并补齐 Linux 磁盘与网卡硬件元数据。
- 增加 Windows GPU Engine/Adapter Memory 回退采集，支持没有 NVIDIA 或 LibreHardwareMonitor 指标时读取 GPU 占用和显存。
- 增加 Linux hwmon/thermal 温度与风扇采集，以及可选 smartctl 磁盘温度回退。
- 增加采集后端状态上报，明确区分已读取、组件未安装和系统未暴露传感器的情况。
