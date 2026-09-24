# Device State Console v3.0.78

## 测试版变更

- 修复 NAS 测试中枢通过 Clash checkout 仓库时的 HTTP/2 framing 与 TLS 中断问题。
- 在部署定义 checkout 前强制 Git 使用 HTTP/1.1，继续使用 NAS Clash 代理完成后续镜像下载与部署验证。
