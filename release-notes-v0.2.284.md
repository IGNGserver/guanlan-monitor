# Device State Console v0.2.284（测试版）

- 延续 v0.2.283 的 NAS 固定版本部署校验。
- GHCR 镜像拉取加入带超时的有限重试，以应对 NAS Docker daemon 的瞬时 TLS 超时；所有重试失败仍会保留当前服务并让工作流失败。
