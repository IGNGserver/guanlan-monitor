# Device State Console v3.0.150

## 连接与本机

- 将桌面端“连接”和“本机 Agent”设置合并为“连接与本机”页面，保留旧的 `#settings/agent` 地址兼容跳转。
- 设备名称改为显式保存，提供“保存设备名称”按钮；清空自定义名称后恢复使用本机设备名。
- 连接配置与 Windows Agent CLI 示例统一使用公网端口 `38472`。

## Agent 身份

- 新安装的 Agent 不再预填 “Windows Agent”，未设置自定义名称时由采集器上报实际设备名。
- 已有配置中的旧占位名称会迁移为空，同时保留自定义设备名称。

## 校验

- PR #40 的本地静态检查、TypeScript 测试以及 CI 中的 Go、Electron、Web、Windows、Android 和视觉回归检查全部通过。

## 安装包

- Windows setup、Windows portable、Windows update、Linux install 与 Android APK 将由 GitHub Actions 构建并随本 Release 发布，并附带 `.sha256` 校验文件。
