# Device State Console v0.2.289（测试版）

## 本次修复

- 修复 Electron 主进程生产编译错误地包含 TypeScript 安全测试文件的问题。
- 保留 Node 22 原生测试入口，避免为测试脚本引入未锁定的额外依赖。

## 验证范围

- GitHub Actions 将执行服务端测试、Electron 类型检查/构建及各平台打包验证。
