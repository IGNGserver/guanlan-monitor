# v0.2.83 测试版

## 图标与本机 Agent 设置修复

- 将观澜 `app-icon.ico` 正式绑定到 Windows Electron 可执行文件、窗口和任务栏，修复安装后仍显示默认旧图标的问题。
- 兼容旧版 Agent 返回 `detectedTargets: null` 或缺少探针数组的状态，避免打开“本机 Agent”设置时渲染线程崩溃黑屏。
- 保持中枢连接、统一图表和侧边栏唤出交互不变。

## 验证说明

这是测试版，不代表稳定发布。构建、打包和 Windows 安装验收由 GitHub Actions 完成。
