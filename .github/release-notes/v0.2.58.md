# Device State Console v0.2.58（测试版）

## 更新能力修复

- 修复 iOS 更新提示的 Swift 字符串插值，恢复 iOS 测试构建。
- Hub 更新页面会在新版本服务恢复后识别当前版本，显示完成并自动刷新。
- 保持更新选择规则：只接受严格高于当前版本的版本；测试版可选择最新正式版或测试版，正式版只选择最新正式版。

## 渠道与安装说明

- Windows GUI：下载并启动 Windows setup，安装前校验 SHA-256。
- Linux GUI：下载 .deb 并交给系统安装器授权。
- Windows/Linux CLI：使用 device-state-console-agent update 自动下载、校验并替换。
- Android：下载 APK 后交给系统安装器；iOS 仅打开 App Store/TestFlight 更新页面。
- Hub：仅通过受保护的测试或正式 GitHub Actions 工作流部署固定版本。
