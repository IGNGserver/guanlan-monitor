# Guanlan Spectrum 视觉审查 Round 2

审查对象：`v0.2.78` 发布资产；真实 390px viewport 使用 iframe 隔离截图，避免 Edge headless 的 500px 最小窗口裁切：

- `artifacts/ui-after/matrix-f-390x844-dark-touch-iframe-v0.2.78.png`
- `artifacts/ui-after/matrix-g-390x844-light-compact-iframe-v0.2.78.png`
- `artifacts/ui-after/matrix-a-1440x900-light-compact-v0.2.78.png`

## 已通过

- 底栏现在严格五等分，`总览/设备/历史/此设备/更多` 全部可见；More popover 与 aria 属性仍保留。
- Mock Preview 标题在真实 390px viewport 中换行，卡片和内容区不再因标题产生横向滚动。
- 1440px 浅色摘要值已恢复可读对比度。
- 初始审查发现 compact header (<=600px) 的操作区仍会挤压左侧 `gl-header-brand`，品牌在真实 390px viewport 中被裁切；该问题已回交 `gemini-3.1-pro-high`。

## Round-2 修复

- Gemini 已在待发布的 `v0.2.79` 中完成修复：品牌 `gl-header-brand` 保持 `flex-shrink: 0` 与 `min-width: max-content`；连接状态在 compact 模式下采用紧凑指示点并保留 accessible label/title；下拉选择框 (`gl-select`) 实施 `min-width: 0`、`text-overflow: ellipsis` 与最大宽度；操作区限制宽度并保留 aria 属性、快捷键与原有功能。

## 验证与检查

- `pnpm check:desktop-ui-boundaries`: 0 违规
- `pnpm test:ui-helpers`: 5/5 测试通过
