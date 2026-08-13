# v0.2.147

- 修复 NAS 测试部署的镜像来源，改用 Docker 发布 workflow 使用的 `ghcr.io` canonical 镜像，绕开 NAS mirror 的 blob 下载卡顿。
- 延续 `v0.2.146` 的 NAS runner 无 checkout 部署流程和 `v0.2.145` 的严格 Compose 健康检查。
