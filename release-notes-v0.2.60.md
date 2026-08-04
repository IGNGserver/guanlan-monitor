# Device State Console v0.2.60（测试版）

## Windows 采集修复

- 修复 Windows CPU 温度读取：改用 UTF-16 编码 PowerShell，并预加载 LibreHardwareMonitor 依赖 DLL。
- 修复 Windows CPU 拓扑：分别上报物理核心数、逻辑处理器数和 CPU 包信息。
- 修复 Windows 进程数、线程数和句柄数：优先使用系统级性能信息 API，避免逐进程权限导致句柄数低估。
- 补齐 CPU 拓扑与系统概览指标的配置同步和展示。

## 渠道与安装说明

- Windows GUI：下载并启动 Windows setup，安装前校验 SHA-256。
- Linux GUI：下载 .deb 并交给系统安装器授权。
- Windows/Linux CLI：使用 device-state-console-agent update 自动下载、校验并替换。
- Android：下载 v0.2.60 APK 后直接覆盖安装；若仍提示签名不一致，请确认使用同一发布渠道的 APK。
- iOS：仅打开 App Store/TestFlight 更新页面。
