# 观澜 v3.0.4 测试版

这是观澜 Web / Electron 共享 UI v3 的验收修复测试版。

- 修复 Windows Release 与 Electron 视觉验收对虚拟机宿主 Agent 状态的文本断言，使验收契约匹配实际详情页渲染。
- 将 Electron 设备详情视觉验收改为稳定的设备行 `aria-label` 选择器。
- 清理共享响应式 CSS 中非法的 `@media` 选择器，避免构建器丢弃触控、竖屏和紧凑布局规则。
- 保留 v3.0.0/v3.0.1 结构性重构中的页面、Context、CSS、健康统计、Widget 编辑、设备顺序草稿、390px 设置导航、全局搜索、行为测试和两轮视觉矩阵。

本版本仅作为 GitHub prerelease 测试版发布，不更新 `latest`，不用于生产部署。
