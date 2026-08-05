# Hub UI coupling map

## 结论

没有发现 Electron Renderer 直接从 `apps/web/src` 导入组件或 CSS；耦合主要表现为视觉/信息架构同构，以及 shared snapshot/API contract 的合法数据耦合。目标是切断前者，保留后者。

## 允许保留的边界

```text
Electron main
  -> preload contextBridge
    -> renderer/services/dscBridge.ts
      -> @dsc/shared snapshot/config types
        -> Guanlan Renderer adapter/view model
```

保留 `dscBridge` 的 IPC 方法与安全调用面；新 Renderer 只能依赖 desktop-safe bridge 和 `@dsc/shared` 类型，不得依赖 Hub Web 的运行时。

## 禁止的新 Renderer 依赖

- `apps/web/src/**` 的 React 组件、hooks、CSS、CSS modules、layout、chart wrapper。
- Hub Web 的 `SaaSShell`、`Dashboard`、`DeviceSidebar`、`HomeOverview`、`TrafficCalendar` 等页面语义实现。
- Hub Web 的全局主题变量、font stack、颜色类名或复制后的 dashboard CSS。
- Agent core、Android、iOS 或全局认证实现。

## 现有源码中的同构点

| 当前桌面实现 | Hub/后台式表现 | clean-room 替换要求 |
| --- | --- | --- |
| `components/Shell/Sidebar.tsx` | 固定五项侧栏导航 | 自有 adaptive rail/sidebar/bottom nav |
| `TopHeader.tsx` + `StatusBanner.tsx` | 顶栏 + 横幅堆叠 | 自有标题区、状态胶囊和 toast 层级 |
| `OverviewCards.tsx` | KPI 卡片网格 | 自有 overview narrative 与可折叠 metric groups |
| `TelemetryChart.tsx` | 后台 chart card | 自有 chart spec/rendering，仅保留数据语义 |
| `DeviceSelector.tsx` | 设备列表 + status tabs | 自有 split/list/detail 导航，远端只读 |
| `TrafficCalendarView.tsx` | Hub 风格 traffic calendar | 自有历史/流量视图与 adaptive table/calendar |

## 验收方法

新增 boundary check 扫描 `renderer-guanlan`（名称可由 Gemini 确定）内的 import、字符串路径、CSS token 和 className，遇到 `apps/web`、Hub UI 组件名或 Hub CSS 入口立即失败。检查还要确认旧 Renderer 只在切换回滚路径中存在，不被新 Renderer 隐式引用。
