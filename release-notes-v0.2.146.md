# v0.2.146

- 修复 NAS 私网 runner 无法访问 GitHub 时的测试部署流程：部署 job 不再在 NAS 上 checkout 仓库，仅使用已配置的 Compose 项目更新固定应用镜像。
- 延续 `v0.2.145` 的 Compose 变量传递、应用镜像定向拉取和严格健康检查修复。
