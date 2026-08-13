# v0.2.149

- 修复 NAS 测试部署只更新 server/web：使用 `--no-deps --pull never`，避免因 NAS 旧 Redis 标签差异重建依赖容器。
- 延续 `v0.2.148` 的 Actions 镜像 artifact 传输和 NAS `docker load` 部署方案。
