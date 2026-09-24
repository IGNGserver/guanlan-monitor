# v0.2.205

- Windows 采集优先使用已验证的 PowerShell + LibreHardwareMonitor 路径，避免 .NET 10 探针加载 .NET Framework 版互斥锁 API 失败。
- 在 PawnIO 已安装时恢复 CPU Package/Core 温度采集，并继续沿用核显共享显存与 CPU 温度关联语义。
