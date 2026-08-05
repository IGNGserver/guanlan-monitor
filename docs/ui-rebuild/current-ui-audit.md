# Current desktop UI audit

审计对象：`apps/desktop/src/renderer`，以及 2026-08-05 启动的已安装 Windows 客户端基线。

## 结论

> 这是 v0.2.79 的历史审计。当前实现已按 [refactor-task-v3.md](./refactor-task-v3.md) 收敛为单一 Workspace 入口；本文件保留作 before 证据，不应再作为现行 UI 结构说明。

当前 Renderer 在物理目录上是 Electron 独立 React 应用，但信息架构、视觉语言和组件命名仍然是 Hub 管理后台式的高密度控制台：固定 Sidebar + TopHeader + 状态横幅 + 卡片网格，深色优先、霓虹色强调、英文导航、强边框和高信息密度。它不是 Hub Web 的源码复用，却产生了与 Hub 相同的产品心智，因此需要 clean-room 替换 Renderer，而不是继续覆盖旧 CSS。

## 当前入口与页面

`App.tsx` 通过 `ConsoleProvider` 包住整个应用，渲染 `Sidebar`、`TopHeader`、`StatusBanner`，并按 `activeTab` 切换：

- fleet：设备筛选/设备列表
- device-detail：概览卡、遥测图、实例详情
- local-config：本机 Agent 与显示配置
- traffic-calendar：流量日历
- diagnostics：诊断与 spool

`ConsoleContext.tsx` 同时承担数据加载、2 秒轮询、页面状态、待保存配置、云端推送、Agent 控制、认证弹窗、风扇备注和键盘快捷键，说明视觉重构必须把数据/动作层抽离成适配器，不应重写这些副作用。

## 视觉问题

- 全局 CSS 是 dark-first dashboard 主题，包含 `--bg-dark`、`--bg-card`、`--accent-cyan`、`--accent-purple` 等颜色变量，没有完整的 light/dark token 语义层。
- 固定 Sidebar 与固定内容网格没有 compact/medium/expanded/large 布局切换；窄窗口时内容被挤压而不是改变导航模式。
- system sans + ui-monospace 与卡片阴影、发光色、粗边框组合，缺少桌面工具应有的 Spectrum 式层级、密度、focus ring 和 quiet surface。
- 页面状态主要由“卡片/横幅”承载，空数据、缓存、停止、错误和保存中状态没有统一的状态模型。
- 导航标签和状态文案大量英文（Fleet Overview、Device Telemetry、Diagnostics & Spool），与观澜桌面应用的中文产品语言不一致。
- 当前已安装基线显示为 `DEVICE CONSOLE v0.2.68 (test)`，左侧固定五项菜单；右侧在缓存无设备时显示空卡片，仍然是典型后台控制台形态。

## 需要保留的交互事实

设备列表支持 hostname/ID/OS 搜索与 all/online/offline 筛选；Metric Window 支持 5m 到 1y；本机配置需要显式保存、放弃和同步到 Hub；Agent 需要启动/停止/重启控制；认证、风扇备注、启动项和外部链接均通过安全 bridge 完成；`/`、F5/Ctrl+R、Escape 已存在。

## 基线证据

基线截图保存在 `artifacts/ui-before/`：

- `baseline-window-full.png`：安装版完整窗口，覆盖当前总览、导航、缓存/停止状态和空设备列表。
- `baseline-window.png`：同一窗口的旧尺寸裁切，用于记录窄视口下的左侧导航挤压。
- `baseline-screen.png`：采集时的桌面屏幕快照。

后续视觉审查应以这些文件为 before 证据，不能以新 Renderer 的 mock 状态替代。
