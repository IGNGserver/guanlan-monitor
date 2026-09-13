# 观澜 v3.0.10 测试版

这是观澜 Web / Electron 共享 UI v3 的登录态视觉行为门禁修复测试版。

- 修复 Web 视觉回归中仅改变 hash 不会重新挂载 `UnifiedConsole`、导致登录/空态 fixture 未重新读取认证会话的问题。
- 登录、空态、在线与会话过期状态现在通过带状态标记的完整文档导航覆盖真实会话门禁。
- 保留 v3 的全部页面、Context、CSS、健康统计、Widget 编辑、设备顺序草稿、390px 设置导航、全局搜索及数据/权限契约。

本版本仅作为 GitHub prerelease 测试版发布，不更新 `latest`，不用于生产部署。
