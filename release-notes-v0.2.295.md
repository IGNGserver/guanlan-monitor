# Device State Console v0.2.295（测试版）

本版修复测试环境 NAS runner 本地部署被遗留 SSH Secret 错误拦截的问题：

- NAS runner 执行本地中枢部署时不再要求未使用的远程 SSH Secret 为空。
- 仍通过远程 SSH 部署时继续严格校验私钥与 known_hosts 配置。
- 本版为测试版，不代表稳定发布，也不会自动部署生产环境。
