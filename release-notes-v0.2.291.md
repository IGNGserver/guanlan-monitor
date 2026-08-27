# Device State Console v0.2.291（测试版）

## 本次修复

- 修复 Fastify CORS allowlist 的类型不匹配，继续仅允许配置的精确 origin。
- 对本地 JSON 布局快照的顶层结构执行显式校验，消除不安全的结构断言。

## 验证范围

- GitHub Actions 将执行服务端测试、全仓 typecheck/build 及各平台打包验证。
