# 观澜 v3.0.2 测试版

这是观澜 Web / Electron 共享 UI v3.0.1 的修复测试版。

- 修复 v3.0.1 拆分过程中残留的旧 DeviceDetails JSX 尾段，恢复 `@dsc/console-ui` TypeScript 构建门禁。
- 保留宽屏 Web 空白、全局健康统计、页面/Context/CSS 拆分、显式 Widget 编辑、设备顺序草稿、390px 设置导航、全局搜索和两轮视觉矩阵改动。
- GitHub Actions 将继续执行共享 UI 行为测试、Web/Electron 视觉证据、Windows Release setup 静默安装与实机启动验收。

本版本仅作为 GitHub prerelease 测试版发布，不更新 `latest`，不用于生产部署。
