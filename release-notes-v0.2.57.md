# Device State Console v0.2.57（测试版）

## 更新系统

- 增加统一更新检查 API，严格禁止降级和同版本重装，并按测试/正式通道选择可升级版本。
- Hub 网页增加更新提示；启用受保护部署配置后，可从网页派发固定版本更新工作流。
- Windows GUI、Linux GUI、Android 增加下载、校验和系统安装器流程；iOS 仅提示并跳转 App Store/TestFlight 或 Release 页面。
- Windows/Linux CLI 增加 `device-state-console-agent update`，支持校验、配置保留、服务重启和失败回滚。
- Agent 上报版本和发布通道，Hub 设备列表展示 agent 版本。

本版本是测试版，正式发布前请验证签名密钥、更新包校验和、UAC/系统授权以及部署工作流的回滚路径。
