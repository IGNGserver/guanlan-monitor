# v0.2.298 测试版

- 测试部署产物现在同时携带固定版本的 Redis 和 MySQL 基础镜像，适配 NAS 无法访问 Docker Hub 的环境。
- 旧 NAS Compose 迁移在中断后可识别已恢复的运行中 MySQL root 凭据并安全重试。
- 保留测试渠道 6 位 `ACCESS_KEY`、旧 MySQL 凭据和内部地址 `mysql:3306` 兼容性。
- 本版本是测试版，不代表正式生产发布。
