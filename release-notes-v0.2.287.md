# Device State Console v0.2.287（测试版）

## 本次修复

- 修复 CI/Release/Docker 发布门禁未注入测试运行时凭据导致服务端测试无法启动的问题。
- 修复 Electron 渲染器安全测试的 TypeScript NodeNext 导入路径与测试运行方式。

## 验证范围

- GitHub Actions 将执行服务端测试、Electron 类型检查/构建及各平台打包验证。
