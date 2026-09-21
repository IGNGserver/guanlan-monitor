# Device State Console v3.0.75

## 测试版变更

- 将 NAS 测试中枢部署的固定镜像 artifact 改为 64 MiB 分片传输，并在 NAS runner 合并后执行 SHA-256 校验，避免大文件下载截断导致无法加载镜像。
- 保持 v3.0.74 的 Clash 代理 workflow 修复、UI 与业务行为修复内容不变。
