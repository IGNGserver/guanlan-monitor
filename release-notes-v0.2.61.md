# Device State Console v0.2.61（测试版）

## Windows 采集修复

- 延续 v0.2.60 的 Windows CPU 温度、CPU 拓扑、进程数、线程数和句柄数修复。
- 修正旧配置迁移：用户显式选择 GPU 指标时不再被自动追加新的 GPU 指标，保持原有选择不变。

## 渠道与安装说明

- Windows GUI：下载并启动 Windows setup，安装前校验 SHA-256。
- Linux GUI：下载 .deb 并交给系统安装器授权。
- Windows/Linux CLI：使用 device-state-console-agent update 自动下载、校验并替换。
- Android：下载 v0.2.61 APK 后直接覆盖安装；若仍提示签名不一致，请确认使用同一发布渠道的 APK。
- iOS：仅打开 App Store/TestFlight 更新页面。
