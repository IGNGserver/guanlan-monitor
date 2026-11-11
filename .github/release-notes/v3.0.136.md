# 观澜 v3.0.136

## 中枢

- 公开访问端口由 `3100` 调整为 `38472`。Docker Compose 默认映射、部署 workflow 与 `verify:hub-port` 门禁同步更新。
- 客户端默认中枢地址与界面示例统一为 `:38472`；已保存 `:4000`、`:3101`、`:3100` 的旧地址会在下次保存连接配置时自动迁移到新端口，无需手工修改。
- 反向代理（frps）需要把 `device-state-console` 的内网与外网端口同时指向 `38472`。

## 桌面端

- 修复窗口状态事件转发：最大化/还原/全屏监听改由 `createWindow` 在窗口创建后挂载，标题栏按钮不再停留在启动时的状态。
- 恢复外壳滚动与原生标题栏按钮的布局。

## 安装包

- Windows setup、Windows portable、Windows update、Linux install 与 Android APK 均随本 Release 发布，并附带 `.sha256` 校验文件。
