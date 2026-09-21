# Device State Console v3.0.76

## 测试版变更

- 修复 NAS 测试中枢大体积镜像 artifact 下载超时：通过 Clash 代理并行下载并解压镜像分片，再执行完整 SHA-256 校验。
- 将 NAS 测试部署 job 的超时时间调整为 60 分钟；备份、Compose 替换、容器重启和布局持久化验证仍保持在校验成功之后执行。
