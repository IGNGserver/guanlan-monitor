# v0.2.266

- 测试 Agent 分发改为在 Actions runner checkout 对应版本源码并构建 Linux Agent，绕开 NAS 到 GitHub Release CDN 的不可用下载链路。
- 构建完成后校验版本并通过 SSH 分发到测试节点。
