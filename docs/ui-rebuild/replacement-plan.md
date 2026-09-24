# Guanlan Spectrum Adaptive replacement plan

> 本文是早期迁移记录。`refactor-task-v3.md` 是当前生产入口、信息架构和防复发规则的准则；当两者冲突时，以 v3 为准。

## Scope

只替换 Electron Renderer 视图层；main/preload/IPC、Agent lifecycle、Hub API/cache/config、tray、installer、Hub Web、Android、iOS 和 Agent core 不在范围内。

## Implementation ownership

所有 frontend UI、token、layout、theme、density、chart、interaction test、screenshot review 和 UI 修复由 `agy` 的 `gemini-3.1-pro-high` 直接完成。Luna/Codex 只负责审计、提供约束、接线/边界脚本、CI 静态验证和验收记录；不得接管 UI 编码。

## New Renderer boundary

建立与旧 `renderer` 并列的隔离目录（`apps/desktop/src/renderer-guanlan/workspace/`），先实现 mock adapter，再接入 `dscBridge`；禁止引用 `apps/web` 或旧 Hub UI/CSS。完成 boundary check 后将入口收敛为单一生产 Renderer。

## Visual system

- Design system name: Guanlan Spectrum Adaptive。
- Spectrum 2 作为主视觉依据；Material 3 Adaptive 只借鉴窗口分级和导航布局方法；Carbon Charts 只借鉴图表规范。
- compact `<600`、medium `600–839`、expanded `840–1199`、large `>=1200`。
- interaction scale 与 layout 独立：compact / comfortable / touch；依据 pointer/hover/touch 自动选择并持久化手动覆盖。
- light/dark/system 三态，低对比度和 reduced motion 可用；不使用渐变、发光霓虹和默认 dashboard KPI 堆叠。

## Information architecture

总览、设备、历史、此设备、诊断、设置。compact 使用 bottom navigation 或同等可发现导航；medium 使用 compact rail；expanded/large 使用 adaptive rail/sidebar。远端详情和本机设置要清晰区分。

## Delivery gates

1. Gemini 完成独立 mock UI 和 token/interaction contract。
2. Gemini 进行至少两轮视觉审查，保存 before/after 矩阵和 round-1/round-2/final 报告。
3. 新 Renderer 接入 bridge，完成功能对等矩阵、边界检查、TypeScript/lint/interaction/layout/theme/keyboard/no-overflow 测试。
4. CI 完成 Windows/Linux 构建与打包静态门禁；本地不执行项目构建、安装包生成或 Docker 构建。
5. 读取 Actions、Release 资产和实际 Windows 安装结果，再给出 GOAL STATUS。
