# Device State Console v0.2.62（测试版）

## Windows GUI 设置

- 修正 WinUI 指标配置弹窗的 XAML 编译兼容性，支持生成 Windows GUI setup、portable 和 update 资产。
- 保留所有类别的 WinUI 风格指标配置入口，以及“保存并退出 / 不保存并退出”草稿行为。

## 渠道与安装说明

- Windows GUI：下载并启动 Windows setup，安装前校验 SHA-256。
- Linux GUI：下载 .deb 并交给系统安装器授权。
- Windows/Linux CLI：使用 device-state-console-agent update 自动下载、校验并替换。
- Android：下载 v0.2.62 APK 后直接覆盖安装；若仍提示签名不一致，请确认使用同一发布渠道的 APK。
- iOS：仅打开 App Store/TestFlight 更新页面。
