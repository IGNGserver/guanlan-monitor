# Device State Console v0.2.293（测试版）

本版延续 v0.2.292 的审计整改，修复 Windows GUI 安装验收在 GitHub Actions Windows runner 中的字符编码误报：

- Windows 安装后校验不再依赖中文可执行文件名字面量，改为在固定安装目录内识别唯一的非卸载器主程序。
- 仍校验安装目录中 `app.asar` 的版本，避免将“文件存在”误当成正确安装。
- 包含 v0.2.292 的全部审计整改；设备通信统一 `ACCESS_KEY` 的已接受风险保持不变。

本 Release 为测试版，不代表稳定发布，也不会自动部署生产环境。
