# Device State Console v0.2.59（测试版）

## Android 升级修复

- 修复从 v0.1.10x 升级到 v0.2.x 时 Android 错误提示“不允许降级安装”的问题。
- Android 安装版本号改为按语义版本递增编码，后续跨大版本升级不会因内部 `versionCode` 回退而被系统拒绝。

## 渠道与安装说明

- Windows GUI：下载并启动 Windows setup，安装前校验 SHA-256。
- Linux GUI：下载 .deb 并交给系统安装器授权。
- Windows/Linux CLI：使用 device-state-console-agent update 自动下载、校验并替换。
- Android：下载 v0.2.59 APK 后直接覆盖安装；若仍提示签名不一致，请确认使用同一发布渠道的 APK。
- iOS：仅打开 App Store/TestFlight 更新页面。
