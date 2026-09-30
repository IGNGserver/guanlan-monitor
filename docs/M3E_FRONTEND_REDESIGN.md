# 观澜共享前端 · Material 3 Expressive 重设计方案

> 适用范围：`packages/console-ui`（Web + Electron 共享控制台）、`apps/web` 路由与登录页、
> 受其约束的校验脚本与视觉回归。**不**改变 `ConsoleAdapter` / Hub 协议 / Hash 路由 / Agent 契约。
>
> 本文取代 `docs/UI_REDESIGN_MATERIAL3.md` 作为**现行**前端设计契约。旧文档记录的是
> “M3 语义色 + Carbon 组件”的过渡态，正是本次要推翻的对象。

---

## 0. 结论

当前前端不是 Material 3，也不是 Material 3 Expressive。它是 **Carbon 的布局逻辑（矩形层、1px 细线、
零阴影、IBM Plex、`--cds-*` 令牌树）外面套了一层 M3 语义色变量**，而这一层变量又被显式指回
Carbon（`workspace.tokens.css` 里“Carbon is the single source of truth for colour”）。

因此本次不是“换皮”，而是**更换设计系统的实现底座**：

1. 从依赖图里**移除 `@carbon/react` 与 `@carbon/charts-react`**（及 `--cds-*`、`cds--*` 选择器、
   `@carbon/styles` 的栅格与主题）。没有任何组件再来自 Carbon。
2. 新建 `packages/console-ui/src/m3e/` 作为**唯一**的 M3E 实现底座：令牌、原生组件、图标、图表。
3. 页面与外壳**全部重写**为消费 `m3e/`，删除 `m3.tsx` 的 Carbon 包装、`CarbonCharts.tsx`、
   `workspace-carbon.scss` 仲裁层、所有 `--cds-*` 回退。
4. 数据/权限/路由/适配器契约**原样保留**；视觉回归脚本改为断言新的 M3E 结构。

「完全重写前端」= 表现层 100% 替换，逻辑层 100% 保留。

---

## 1. 现状病理（证据）

| # | 症状 | 证据 |
| --- | --- | --- |
| 1 | M3 色被指回 Carbon，主题其实由 Carbon 决定 | `workspace.tokens.css:302-416` `.guanlan-carbon-theme { --workspace-color-primary: var(--cds-link-primary)… }`；注释自述“Carbon is the single source of truth” |
| 2 | 组件层是 Carbon 包装 | `m3.tsx` 全部 import 自 `@carbon/react`：`M3Button→CarbonButton`、`M3SegmentedControl→ContentSwitcher`、`M3Switch→Toggle`、`M3TextField→TextInput`、`M3Select→Select`、`M3Checkbox→Checkbox` |
| 3 | 图标是 Carbon 图标 | `ui.tsx:4-29` `@carbon/react/icons`；`Icon` 直接渲染 `CarbonIconType` |
| 4 | 图表是 Carbon Charts（d3） | `CarbonCharts.tsx:2` `@carbon/charts-react` 的 `AreaChart/DonutChart/LineChart/MeterChart/SimpleBarChart`；`theme: g10\|g100` |
| 5 | 表格/弹窗/标签/页签/通知是 Carbon | `shared.tsx` `Table*`、`Modal`、`Tag`、`ActionableNotification`；`CommandPalette` `Modal,Search`；`DeviceDetailsPage` `Tab/TabList/Tabs`；`ChartTile` `Tile,Button`；`deviceCharts` `StructuredList*` |
| 6 | 布局是 Carbon 2x Grid 约定 | `dashboard.css` 注释“列数与断点对齐 Carbon 2x Grid（4/8/16）”；`ChartTile` 用 Carbon `Tile` 再被 `dashboard.css` 把直角/1px 覆盖回去 |
| 7 | 外壳用 Carbon 主题包裹 | `WorkspaceFrame.tsx:2,36,112` `import { Theme } from "@carbon/react"` + `<Theme theme={g10\|g100}>` |
| 8 | 存在一层 1730 行的“仲裁层” | `workspace-carbon.scss` 全部规则把 Material 圆角改回 0、把卡片阴影改成 1px 细线；`dashboard.css:10` 自述“形状遵循 Carbon：直角、1px 细线” |
| 9 | 样式入口把整套 Carbon Sass 打进来 | `styles.scss` `@use "@carbon/react"` + `@import "@carbon/charts-react/styles.css"` |
| 10 | 字体/圆角/动效混杂四套 | `Geist`（shell）、`IBM Plex Sans`（carbon scss + globals）、`IBM Plex Mono`（数值）、Carbon motion 曲线与 M3 spring 曲线并在 |
| 11 | Web 登录页是第三套写死色 | `auth.module.css` 直接 `#3d638f/#f7f8fa/#20242a` + 暗色媒体查询，未走语义令牌 |
| 12 | 表意与命名混乱（carbon/fluent/spectrum/m3 残留） | 全仓计数：carbon 80 / Carbon 171 / Material 121 / M3 89 / m3 259；“Spectrum”“Fluent”仅存于注释与 helper 文档头 |

**结论**：M3 只是变量名，Carbon 才是渲染引擎。任何“微调圆角/加阴影”的做法都会被 Carbon 的
组件样式和 `workspace-carbon.scss` 仲裁层反噬——这就是它反复回弹的原因。必须换底座。

---

## 2. 不可动摇的契约（重写红线）

重写必须保持下列内容逐字不变，否则会破坏 Web/桌面/CI：

**类型与端口**
- `ConsoleAdapter`、`ConsoleCapabilities`、`ConsoleReadPort/SessionPort/FleetPort/LocalAgentPort`。
- `WEB_CAPABILITIES` / `DESKTOP_CAPABILITIES` 的**取值**（`adapter.contract.test.ts` 精确断言）。
- `emptyConsoleSnapshot` / `fallbackWindowState` / `fallbackRuntimeProfile` / `fallbackWindowMaterial*`。
- `ConsoleSnapshot`、`PreferencesStartup` 等 `@dsc/shared` 类型不改。

**路由与持久化**
- `parseWorkspaceHash` / `serializeWorkspaceRoute` / `defaultRoute`；设置分段 id 与别名
  （`workspace→general`、`session→connections`、`hub→overview`）。
- localStorage 键：`dsc-theme`、`dsc-density`、`dsc-refresh-interval`、`dsc-sidebar-collapsed`、
  `dsc-onboarding-dismissed`。

**数据属性**（CSS 与图表读它们；可保留原名，属实现细节）
- `data-dsc-theme` / `data-dsc-resolved-theme` / `data-dsc-density` / `data-dsc-density-setting` /
  `data-dsc-pointer` / `data-dsc-touch-support` / `data-dsc-material` / `data-dsc-runtime-mode` /
  `data-dsc-memory-pressure` / `data-dsc-orientation` / `data-dsc-tier`。

**包出口**
- `@dsc/console-ui` 默认导出 `WorkspaceApp({adapter, initialRoute})`；具名 `M3*` 组件在同路径导出
  （`login-form.tsx` 依赖 `M3Button`/`M3TextField`）。
- 子路径 `./styles.scss`、`./styles.css`、`./window-material.css`、`./assets/*` 保持存在。
- `apps/desktop/vite.config.ts` 的 `manualChunks` 规则需同步（移除 Carbon 分块，改为 `m3e` 分块）。

**诊断契约**
- `SettingsPage.tsx` 必须留在原位且其相对 import 闭包覆盖 `check-desktop-agent-state.mjs` 的 30 个字段。
- `diagnostics.ts` / `shortcuts.ts` / `captionGlyphs.ts` / `chartIdentity.ts` / `configKeys.ts` /
  `selectors.ts` / `formatters.ts` / `routes.ts` / `deviceOrderDraft.ts` 逻辑不动。

**边界脚本**
- `check-desktop-ui-boundaries.mjs`：workspace 内不得出现 emoji、旧组件名、旧令牌。
- `check-web-ui-boundary.mjs`：路由必须经 `UnifiedConsole`，legacy 归档不得回流。

---

## 3. M3E 设计系统定义（新底座）

所有数值集中在 `m3e/tokens.css`，页面/组件不得自带颜色、圆角、时长或字号。

### 3.1 色彩：真正的 M3E tonal palette

Carbon 的调色是固定阶（gray-10…gray-100 / blue-60…）。M3E 的色彩是**由源色算法生成 tonal palette
（0–100 的 13 档）再映射到语义角色**。为可审计与可复现，本方案在构建期用脚本生成，仓库内固化结果。

- 源色（品牌）：观澜蓝 `#3D638F` 附近取 `seed = #3B6088`（HCT 约 H=245, C=32）。
  中性色取同色相的极低 chroma，得到带蓝调的 surface 层级（M3 的“彩色中性”）。
- 生成 13 档 tone：`0,10,20,30,40,50,60,70,80,90,95,99,100`。
- **浅色**：primary=P40、onPrimary=N100、primaryContainer=P90、onPrimaryContainer=P10、
  surface=N99、surfaceContainerLowest=N100、surfaceContainerLow=N96、surfaceContainer=N94、
  surfaceContainerHigh=N92、surfaceContainerHighest=N90、onSurface=N10、onSurfaceVariant=N30、
  outline=N50、outlineVariant=N80。
- **深色**：primary=P80、onPrimary=P20、primaryContainer=P30、onPrimaryContainer=P90、
  surface=N10、surfaceContainerLowest=N0、surfaceContainerLow=N10…Highest=N24、
  onSurface=N90、onSurfaceVariant=N80、outline=N60、outlineVariant=N30。
- 支持色同样成对：`error/onError/errorContainer/onErrorContainer`，以及监控产品需要的
  `success`、`warning`、`info`（各自容器色）。
- 三级固定 accent 色板供图表序列使用（M3E 的“多色表达”）：`accent-1..5`，浅深各一组。

CSS 变量命名统一前缀 `--md-sys-*`（system）与 `--md-elev-*`（组件级），旧 `--workspace-*` 仅作为
**一版过渡别名**指向新令牌，随页面重写逐步删除；不再出现任何 `--cds-*`。

### 3.2 形状（M3E shape scale）

| 角色 | 值 |
| --- | --- |
| none | 0 |
| extra-small | 4 (chip 内元素) |
| small | 8 (chip、小控件) |
| medium | 12 (按钮、输入框、列表面板) |
| large | 16 (卡片、分组) |
| large-increased | 20 |
| extra-large | 28 (FAB、对话框) |
| extra-extra-large | 32 (大容器) |
| full | 9999 (胶囊：segmented、nav indicator、badge) |

M3E 特征：容器越大圆角越大；**卡片禁止直角**（这是与 Carbon 最直观的分野）。

### 3.3 海拔（shadow）与表面

M3E 用 **surface tint + shadow**，不再“靠 1px 线分层”。5 档：
`level0`（无影）→ `level1`(卡片静止) → `level2`(菜单/悬浮) → `level3`(对话框) → `level4`(snackbar/nav)。
每档 = 环境阴影 + 定向阴影，颜色取 `on-surface` 的极低透明度。窗口 Mica 下通过
`data-dsc-material` 把 surface 改为透明混合，阴影保持不变。

### 3.4 排版（M3E type scale）

字族：`"Roboto Flex", "Roboto", "Noto Sans SC", "PingFang SC", "Microsoft YaHei UI", system-ui`。
不打包字体文件（CSP `font-src 'self' data:` 不允许外链；本机可离线）。数值统一
`font-variant-numeric: tabular-nums`。

角色（size/line/weight/letter）：
`display-l 57/64/400`、`headline-l 32/40/400`、`headline-m 28/36/400`、`headline-s 24/32/400`、
`title-l 22/28/400`、`title-m 16/24/500`、`title-s 14/20/500`、`body-l 16/24/400`、
`body-m 14/20/400`、`body-s 12/16/400`、`label-l 14/20/500`、`label-m 12/16/500`、`label-s 11/16/500`。

### 3.5 动效（M3E motion physics）

官方 M3E 用 **spring** 物理。Web 端以等效 cubic-bezier + 时长表达，按“空间(位移/尺寸)”与
“效果(颜色/透明度)”分轴：

- spatial fast `350ms cubic-bezier(0.42,1.67,0.21,0.90)`
- spatial default `500ms cubic-bezier(0.38,1.21,0.22,1.00)`
- spatial slow `650ms cubic-bezier(0.39,1.29,0.35,0.98)`
- effects fast `150ms`、default `200ms`、slow `300ms`
- 弹簧“过冲”只用于空间属性（fab 展开、sheet 进入、nav indicator 位移）；颜色/透明度只用 effects 曲线。
- `prefers-reduced-motion: reduce` 时全部压到 1ms，且禁用过冲。

### 3.6 状态层（state layer）与涟漪（ripple）

统一 `::before` 覆盖层：`hover 8% / focus 10% / pressed 10% + ripple 12%`，颜色 = `currentColor`。
交互组件按下时叠加从指针落点扩散的圆环（ripple），150ms 展开、200ms 淡出；无指针设备退化为整体加深。

### 3.7 可访问性

- 触控目标 ≥ 48dp（M3E 建议），桌面密集区 ≥ 40px，`@media (pointer: coarse)` 强制 48px。
- 焦点环：3px `--md-sys-color-secondary`，offset 2px，不依赖 Carbon 的 inset 环。
- 对比度：正文 ≥ 4.5:1，大字 ≥ 3:1；状态色配对保证深浅两侧可读。

---

## 4. 目标架构

```
packages/console-ui/src/
  m3e/                       ← 唯一表现层底座（新增）
    tokens.css               令牌（色彩/形状/海拔/排版/动效/状态层）
    base.css                 重置 + 排版工具类 + 涟漪/状态层基元
    icons.tsx                内联 M3 图标集（24dp outline，继承 currentColor）
    primitives.tsx           Button/FAB/IconButton/Chip/Segmented/Switch/Checkbox/
                             Radio/TextField/Select/List/NavItem/Tabs/Dialog/Menu/
                             Snackbar/Banner/Progress/Card/Divider/Ripple
    charts.tsx               纯 SVG 图表（line/area/bar/donut/meter/sparkline）
    index.ts                 聚合导出
  workspace/                 ← 业务层（重写消费 m3e）
    WorkspaceApp.tsx         Provider → Frame → RouteView（结构保留）
    shell/                    Frame / PrimaryNav / TopBar / BottomNav / Command /
                             Onboarding / PullToRefresh / NativeTitleBar*
    pages/                    Overview / Devices / DeviceDetails / Settings / Login
    dashboard/                固定布局常量（types/deviceDashboard 不动）+ Card/Raster
    theme/                    令牌消费钩子、主题/density/material 解析（逻辑不动）
  services/ helpers/          逻辑不动
```

依赖方向：`workspace → m3e`，单向；`m3e` 不 import 任何 `workspace` 内容，也不 import Carbon。

---

## 5. 组件规范（节选）

每个组件给出：结构 / 尺寸 / 状态 / 动效 / 替换对象。

| M3E 组件 | 结构 | 尺寸 | 替换 |
| --- | --- | --- | --- |
| Button | 容器 + 状态层 + [前图标][label][后图标] | sm 32 / md 40 / lg 48，radius full 或 medium | CarbonButton、`.m3-button` |
| FAB / Extended FAB | 圆形/胶囊 + 状态层 | 56 / 96×56，elev3 | 无（新增，用于“刷新/新建”主行动） |
| Icon button | 圆形 + 状态层 | 40 / 48(touch) | CarbonIconButton |
| Segmented button | 容器 + 连接段 + 选中指示 | 40，radius full，选中段带 check 图标 | ContentSwitcher、`.m3-segmented-control` |
| Chip / Filter chip | 胶囊 + [check][avatar][label] | 32 | `.m3-chip` |
| Switch | pill track + thumb + 状态层 | 52×32 | Carbon Toggle |
| Checkbox / Radio | 18px 方/圆 + 状态层 | 48 行高 | Carbon Checkbox |
| Text field | 容器 + label（浮动）+ 输入 + 支持/错误文本 | 56 高，radius 4 顶角（filled）或 medium（outlined） | TextInput、`.m3-field` |
| Select | 同上 + 菜单锚点 | 56 | Carbon Select |
| Navigation drawer/rail/bar | NavItem + active indicator（胶囊） | rail 80 / drawer 360 / bar 80 | `.workspace-sidebar`、`.workspace-bottom-nav` |
| Tabs | 容器 + primary/secondary indicator | 48 / 64 | Carbon `Tabs`、`.cds--tabs` |
| Card | 容器 + 内容 + 可选操作/hero 数值 | radius 16，elev1 | Carbon `Tile`、`.chart-tile`、`Surface` |
| Dialog | scrim + 容器（radius 28，elev3） | 最小 280，最大 560 | Carbon `Modal` |
| Menu | 锚定面板（radius 4/8，elev2） | 行 48 | Carbon Select 下拉、OverflowMenu |
| Snackbar | 胶囊/矩形（radius 4，elev3） | 48–68 | `.workspace-toast` |
| Inline banner | 容器 + 图标 + 文本 + 操作 | — | Carbon ActionableNotification、`.m3-inline-banner` |
| Progress | linear（M3E wavy）+ circular | 4 / 48 | `.workspace-refresh-bar`、skeleton |
| List / List item | 行 + leading/trailing + 状态层 | 56 / 72 | Carbon StructuredList、`.workspace-setting-row` |

**数据表**在 M3E 里不是一等组件（Material 的 data table 属“可选”），本产品保留表格语义，
但重写为 `m3e` 的 `DataTable`：表头 `title-s`、行高 52、hover 状态层、圆角容器、无竖线，
移动端切换为卡片列表（现有 `DeviceCard` 升级为 M3E `Card`）。

---

## 6. 信息架构与页面重设计

### 6.1 导航（M3E adaptive navigation）

- **≥1200px（expanded/large）**：常驻 `NavigationDrawer`（360），active indicator 为胶囊。
- **600–1199px（medium）**：`NavigationRail`（80，仅图标 + tooltip），可展开为 drawer。
- **<600px（compact）**：`NavigationBar`（底部，80），3 个目的地；设置作为 bar 的第三项。
- M3E 特征：indicator 形变（选中项 capsule 从旧项**滑移**到新项，spatial 弹簧），不再瞬切背景色。

### 6.2 总览（Overview）

- 顶部 `LargeTopAppBar`（标题随滚动折叠为 small）。
- 4 张 **stat card**（接入/在线/关注/中枢）用 M3E `Card` + `hero stat` 大字号 + 支持色。
- 「需要关注」区：卡片网格 + 表格（可访问性冗余保留）。
- 观察趋势：`SegmentedButton` 切指标 + 全宽 `Chart` card。
- 中枢状态从“事实表”改为 M3E `Card` + `List`。

### 6.3 设备目录（Devices）

- `SearchBar`（M3E search bar，胶囊）+ Filter chips + Sort `Menu`。
- 桌面 `DataTable`，移动 `Card` 列表；管理顺序进入 M3E `Dialog` 确认。

### 6.4 设备详情（DeviceDetails）

- 面包屑 → M3E `Tabs`（primary indicator）。
- 事实条改为 M3E `Card` + `List` 两列。
- 分区锚点改 M3E `FilterChip` 行（sticky）。
- 图表卡片统一 `ChartCard`（hero 数值 + badge + 详情切换）。
- 全屏用 M3E FAB。

### 6.5 设置（Settings）

- 左 `List` 分类（桌面）/ 顶部 chips（移动）。
- `SwitchRow`/`Select`/`SegmentedButton` 全部 M3E。
- Agent 诊断保留（`check-desktop-agent-state` 契约），但用 M3E `List` + `Banner`。

### 6.6 登录（Web）

- 单卡片居中：`Card`（radius 28，elev3）+ filled text field + filled button。
- 全部走语义令牌，删除第三套写死色。

---

## 7. 图表系统（替换 Carbon Charts / d3）

`m3e/charts.tsx` 用纯 SVG + React 实现，无第三方图表依赖：

- **折线/面积**：`path` 生成 `d`，`curveMonotoneX` 等价实现；面积用线性渐变（accent→透明）。
- **柱状**：M3E 圆角顶柱（`rx` 取 bar 宽 1/2）。
- **环形**：`circle` + `stroke-dasharray`，中心读数。
- **仪表**：M3E 半圆轨道 + 状态区间分段着色。
- **数值网格**：纯排版（已有）。
- 坐标轴/tooltip/legend 自绘，全部用系统排版令牌与 `tabular-nums`。
- 保留 `chartIdentity.ts` 的 memo 指纹与 `prefersReducedMotion` 逻辑；动画用 M3E spatial 弹簧。
- 触控手势覆盖层 `ChartTouchGestureOverlay` 逻辑保留，仅改类名。

这样移除 `@carbon/charts-react` + `d3-*`（`vendor-charts` 分块随之消失）。

---

## 8. 迁移映射（旧 → 新）

| 旧 | 新 |
| --- | --- |
| `styles.scss @use "@carbon/react"` | 删除；入口 import `m3e/tokens.css` + `m3e/base.css` |
| `.guanlan-carbon-theme` | `.m3e-theme`（`data-dsc-resolved-theme` 驱动） |
| `--cds-*`（202 处） | `--md-sys-*` |
| `--workspace-*` | 先保留为别名，逐页替换后删除 |
| `m3.tsx`（Carbon 包装） | `m3e/primitives.tsx`（原生） |
| `ui.tsx` 的 Carbon 图标 | `m3e/icons.tsx` |
| `CarbonCharts.tsx` | `m3e/charts.tsx` |
| `workspace-carbon.scss`（1730 行仲裁） | 删除；几何/圆角/阴影由 `m3e` 直接定义 |
| `dashboard.css` 的 `.cds--*` | M3E 组件样式 |
| `CarbonDeviceTable` | `m3e/DataTable` |
| `ConfirmDialog/PromptDialog`（Carbon Modal） | `m3e/Dialog` |
| `ActionableNotification` | `m3e/InlineBanner` |
| `Tag` | `m3e/Chip`（tonal） |
| Carbon `Tabs` | `m3e/Tabs` |
| `StructuredList*` | `m3e/List`/`m3e/DataTable` |
| Carbon `Tile` | `m3e/Card` |

类名策略：**保留 `workspace-*` 前缀**（视觉回归脚本与桌面 CSS 引用它），但样式全部改写为 M3E；
组件级类名去掉 `m3-*`，统一为 `m3e-*`。视觉回归脚本同步更新 `cds--*`/`m3-*` 选择器。

---

## 9. 测试与验收

- 逻辑测试（routes/selectors/dashboard/chartIdentity/configKeys/diagnostics/captionGlyphs/
  layout/adapter-contract）**不改**，全部保持通过。
- `scripts/electron-visual-regression.cjs` 与 `scripts/visual-regression.cjs`：
  选择器从 `.cds--data-table`→`.m3e-data-table`、`.cds--tabs`→`.m3e-tabs`、
  `.m3-segmented-control`→`.m3e-segmented`、`.m3-navigation-item`→`.m3e-nav-item`、
  `.guanlan-carbon-theme`→`.m3e-theme`；几何断言（caption 46×32、windowbar 32、shell 帧可滚动、
  移动端无横向溢出、底部导航三项）保留。
- 新增静态守卫 `scripts/check-m3e-boundaries.mjs`（建议合并进 `check:desktop-ui-boundaries`）：
  - `packages/console-ui/src` 内**禁止**出现 `@carbon`、`--cds-`、`cds--`、`guanlan-carbon`；
  - `m3e/` 内禁止 import `workspace/`。
- `check:desktop-ui-boundaries` 的 `workspaceDir` 跳过逻辑需覆盖新增的 `m3e/`。

**验证命令**：`pnpm install` → `pnpm typecheck` → `pnpm lint` → 边界/契约/工作区测试全套 →
`pnpm verify:version`；视觉回归在有 Electron 环境处执行。

---

## 10. 实施顺序（每步独立可验证）

1. **底座**：`m3e/tokens.css`、`base.css`、`icons.tsx`、`primitives.tsx`、`charts.tsx`。
2. **依赖下线**：删 `@carbon/*` 依赖、`styles.scss` 的 Carbon import、`workspace-carbon.scss`。
3. **外壳重写**：Frame/主题包裹、Drawer/Rail/Bar、TopBar、Command、Onboarding、PullToRefresh、
   NativeTitleBar（仅窗口 chrome 保持 OS 保真）。
4. **页面重写**：Overview → Devices → DeviceDetails → Settings → Login。
5. **图表接入**：`deviceCharts` 与 `dashboard` 切到 `m3e/charts`，删 `CarbonCharts.tsx`。
6. **脚本与回归**：更新视觉回归选择器、新增边界守卫、跑全套验证。
7. **清理**：删除 `--workspace-*` 残留别名、`.cds--*`/`.m3-*` 死规则。

### 风险与对策
- **窗口 chrome 保真**：Windows 标题栏 46×32、10×10 发丝字形是 OS 契约，**不**套 M3E 圆角/阴影；
  视觉回归对此有精确断言。这是唯一允许“非 M3E”的区域。
- **Mica 材质**：`window-material.css` 机制保留，令牌改名后重新绑定。
- **回归脚本大规模改选择器**：一次性在步骤 6 完成，避免中间态。
- **无本地 pnpm**：本机用 `corepack pnpm`（已可用）。

---

## 11. 明确不做

- 不改 `ConsoleAdapter`/Hub/Agent/权限/路由语义。
- 不改 Android（One UI）与 `windows-agent`（WinUI）原生客户端。
- 不引入第三方 UI 库（Polaris/MUI/MDUI）——`m3e` 自绘，避免再次出现“库逻辑 vs 设计系统”错位。
- 不打包 Web 字体文件（CSP 与离线约束）。
