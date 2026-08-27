# Device State Console v0.2.290（测试版）

## 本次修复

- 将服务端测试命令限定为仓库现有的五个测试文件，避免把服务启动入口等普通源文件交给 Node test runner。

## 验证范围

- GitHub Actions 将执行服务端测试、Electron 类型检查/构建及各平台打包验证。
