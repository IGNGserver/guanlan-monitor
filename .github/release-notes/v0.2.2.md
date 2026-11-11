# Device State Console v0.2.2

## 测试版

- 将固定版本 Docker 镜像存储切换到 GitHub Container Registry。
- GitHub Actions 使用内置 `GITHUB_TOKEN` 发布 server 和 web 镜像。
- Compose 默认从 `ghcr.io/igngserver` 拉取固定版本镜像。
- 私有 GHCR 镜像在部署主机上使用 `read:packages` token 拉取。

这是测试版发布，不作为稳定安装源或生产环境依据。
