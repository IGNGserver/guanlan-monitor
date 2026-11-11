# Device State Console v3.0.151

## Android

- 修复设备详情与设置页面导航期间可能出现的 Compose 崩溃。预测式返回预览现在只会在实际返回手势进行中、且页面转场结束后挂载，避免同一页面重复使用保存状态 key。
- 增加返回预览在空闲、活动手势、路由转场、模态界面及双栏布局下的回归测试。

## 测试版说明

- 本版本为测试版 prerelease，不是稳定安装源，也不代表生产部署授权。

## 安装包

- Windows setup、Windows portable、Windows update、Linux install 与 Android APK 将由 GitHub Actions 构建并随本 Release 发布，并附带相应校验文件。
