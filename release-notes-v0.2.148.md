# v0.2.148

- 修复 NAS Docker daemon 镜像层拉取卡顿：由 GitHub Actions 预拉取并通过 artifact 传输 server/web 镜像，在 NAS 上 `docker load` 后使用 `--pull never` 启动。
- 延续 `v0.2.147` 的 canonical GHCR 镜像配置、NAS runner 部署和严格健康检查。
