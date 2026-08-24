# v0.2.267

- 测试 Agent 分发改为由 GitHub-hosted runner 下载并校验 Release 包，再经 Actions artifact 传递给 NAS runner。
- NAS runner 不再依赖外网 CDN 或 Go 工具链，只负责解包、校验版本并 SSH 分发 Agent。
