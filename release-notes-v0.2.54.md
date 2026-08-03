# Device State Console v0.2.54（测试版）

## 本次更新

- 新增 Linux GNOME 原生 GUI：使用 GTK4/libadwaita 配置本机 Agent。
- 在 Linux GUI 中嵌入 WebKitGTK 中枢页面，统一查看实例和历史数据。
- 新增 Ubuntu/Debian `amd64` Linux GUI `.deb` 安装包，并由 GitHub Actions 完成构建、安装冒烟检查和测试版 Release 发布。
- 修正 Release runner 安装本地 Linux `.deb` 时的路径处理，确保安装验证真正执行。
