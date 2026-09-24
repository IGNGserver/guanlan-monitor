# v0.2.121 测试版

## 修复 Windows 桌面端重新探测硬件报错问题

- 修复点击“重新检测硬件”/“重新探测硬件”时抛出 `agent_backend_500: Error 0: The system cannot find the path specified.` 异常的问题。
- 增加 CPU 探针 PowerShell WMI 兜底机制：在部分 Windows 机器环境 `gopsutil` WMI 异常时自动退回 PowerShell 探测。
- 强化硬件探针分类容错与隔离机制（CPU、磁盘、网卡、显卡），单项探针异常不再影响总体硬件列表返回。
