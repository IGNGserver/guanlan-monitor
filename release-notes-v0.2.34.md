# Release Notes - v0.2.34

## Release and installation automation

- Windows GUI、Android、CLI 资产成功后即可自动发布测试版 Release。
- iOS 构建改为非阻塞，避免 macOS runner 的独立失败阻塞 Windows GUI 发布。
- Release 发布后自动安装 Windows GUI setup。
