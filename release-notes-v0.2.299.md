# v0.2.299 测试版

- 测试部署通过固定 digest 拉取 Redis/MySQL，再以本地固定 tag 随镜像产物交付，适配 NAS 无法访问 Docker Hub 的环境。
- 生产 Compose 默认仍使用 Redis/MySQL digest；仅测试 workflow 显式使用已校验的本地 tag。
- 保留旧 NAS 凭据迁移、6 位测试 `ACCESS_KEY` 和内部 MySQL 地址 `mysql:3306` 兼容性。
- 本版本是测试版，不代表正式生产发布。
