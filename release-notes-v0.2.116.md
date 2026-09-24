# v0.2.116 测试版

## 部署流程

- NAS 部署固定使用已验证可达的 `ghcr.nju.edu.cn` server/web 镜像镜像源，避免 Docker 访问 GHCR 的 IPv6 路由阻塞。
- 固定版本校验、健康检查、失败回滚和部署后凭据清理保持不变。
