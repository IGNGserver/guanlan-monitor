# v0.2.115 测试版

## 部署流程

- 内网 NAS 部署通过 GitHub API 下载目标 tag 的 Compose 定义，避免依赖 NAS 到 Git HTTPS 端点的连通性。
- 仍保留固定版本校验、GHCR 短期登录、健康检查和失败回滚。
