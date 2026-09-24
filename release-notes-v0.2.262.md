# v0.2.262

- 修复测试 Agent 部署流程：由 NAS Runner 下载并校验 Linux Agent 资产，再通过 SSH 分发到目标设备。
- 对 GitHub Release 下载增加可续传重试，避免 PVE 节点直连下载中断导致 Agent 停留在旧版本。
