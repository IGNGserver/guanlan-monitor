# 观澜 Web / Electron v3 全界面重构计划

状态：v3.0.15 第二轮复核仍不通过（2026-09-14）。首轮的宽屏 Web 主内容空白已修复，测试版与 CI smoke 已通过，但仍存在 v3 信息架构、编辑边界、移动端可见性和真实运行证据缺口；当前不得视为 v3 重构完成。第 14 节保留首轮历史，第 15 节为当前复核结论。

目标版本：`3.0.0`。用户已明确授权本次跨越大版本；在完成全部门禁前，`v3.0.0` 仍然只能发布为测试版 prerelease，不得更新 `latest`，不得部署生产环境。

本文件替代此前同名文档中面向早期 Electron Renderer 的 v0.2.x 方案。`docs/UI_REDESIGN_MATERIAL3.md` 只记录上一轮“组件 Material 3 化”的历史，不再作为 v3 的布局依据。

## 1. 重构结论

上一轮迁移完成了 Material 3 token 和控件，但没有真正改变产品骨架。当前页面仍然是：

```text
原生标题栏
└─ 固定侧栏：品牌 + 总览 + 实例类型 + 全部设备 + 本机入口 + 设置
   └─ 固定顶栏：页面名 + 状态 + 搜索 + 刷新 + 外观
      └─ 页面标题：再次显示页面名、状态、刷新与连接操作
         └─ 四块 KPI 卡片 + 设备卡片 + 两块排行卡片 + 四块趋势卡片
```

这解释了为什么更换组件后视觉几乎不变：新的 `M3Button`、`M3SegmentedControl`、`M3Surface` 等仍然装在旧的 Sidebar / TopBar / KPI Card / Dashboard Grid 中，信息层级、空间分配和操作顺序没有变化。

v3 的核心不是再换一轮颜色和圆角，而是完成以下结构性变化：

1. 主导航只承载“去哪里”，不再同时承担设备筛选器和设备清单。
2. 总览只回答“现在是否需要处理”，设备页负责“浏览和管理全部设备”，详情页负责“这台设备发生了什么”。
3. 删除、排序、布局编辑和展板模式进入明确的管理模式或更多菜单，默认浏览态保持安静。
4. 同一信息只出现一次：页面标题、连接状态、刷新操作、设备计数和数据来源不再在三层位置重复。
5. 采用 Google 产品常见的克制感：宽留白、单一内容焦点、低对比度层级、少量 tonal surface、清晰的搜索与导航；不复制 Google 品牌、Logo、字体、文案或账号页内容。

## 2. 真实代码基线

### 2.1 共享架构

- Web 入口：`apps/web/src/components/unified-console.tsx`。
- Electron 入口：`apps/desktop/src/renderer/App.tsx`。
- 两端共同渲染：`packages/console-ui/src/workspace/WorkspaceApp.tsx`。
- Web 通过 `WebConsoleAdapter` 使用 HTTP session、API 与 Socket.IO。
- Electron 通过 `DesktopConsoleAdapter` 和 context-isolated `dscBridge` 使用本机能力。
- `ConsoleCapabilities` 决定登录、缓存、本机 Agent、启动项、原生窗口和连接配置等平台差异。

因此本次必须重构 `packages/console-ui` 的共享信息架构，不能只修改 `apps/web`，也不能把 Electron/Node/IPC 能力直接引入共享组件。

### 2.2 当前工程问题

- `WorkspaceApp.tsx` 约 2942 行，同时包含壳层、导航、搜索、总览、设备详情、中枢、设置和弹窗。
- `WorkspaceContext.tsx` 约 715 行，数据订阅、路由、持久化偏好、窗口能力和所有 mutation 共处一个 Context。
- 工作区 CSS 约 4853 行，以 `tokens → shell → dashboard → telemetry → responsive → m3` 的层叠顺序不断覆盖；Material 3 样式位于旧布局之后，容易形成“新组件覆盖旧结构”的补丁栈。
- `Button` 与 `M3Button`、`Surface` 与 `M3Surface` 并存，交互状态和 DOM 语义不完全统一。
- 侧栏和总览同时列出设备；顶部栏和页面标题同时显示页面身份及刷新入口。
- 总览采用四块等宽摘要卡、左右卡片列和多块图表，信息密度与视觉边界都过高。
- 行末直接暴露上移、下移和删除符号，默认浏览态带有过多管理噪声。
- 移动底栏混合“总览/设备”目的地与“刷新/搜索/置顶”命令，不符合导航心智。
- 当前 Web 视觉脚本只用空设备 fixture，Electron 视觉脚本主要断言旧 Grid/Sidebar/BottomNav 存在；它们不能证明真实数据页面、操作链路或 v3 视觉成立。
- 一部分历史文档仍引用已经不存在的 `apps/desktop/src/renderer-guanlan`，实施时需同步清理或标为历史。

### 2.3 当前工作区保护

制定计划时基线为 `main` / `v0.2.315`，存在三个与本任务无关的未跟踪文件：

- `release-notes-v0.2.104.md`
- `release-notes-v0.2.105.md`
- `release-notes-v0.2.106.md`

实施者必须重新执行 `git status --short --branch`，不得修改、删除、覆盖或提交这些文件，也不得假设届时工作区仍与该快照完全相同。

## 3. 范围与硬边界

### 3.1 本次包含

- Web 登录、加载、会话失效和已登录工作区。
- Windows/Linux Electron 的共享 Renderer 与原生标题栏衔接。
- 共享应用壳层、主导航、命令搜索、总览、设备目录、中枢、设备详情、设置。
- 图表容器、设备行、状态反馈、空/错/缓存/离线/局部缺失状态的布局与交互。
- 桌面端窄窗口、浏览器桌面宽屏、平板、手机和触摸/远控输入。
- 现有 Widget 布局、自定义面板和展板模式的入口重组。
- UI 代码拆分、样式归属、行为测试和 CI 视觉证据。

### 3.2 本次不包含

- Android Compose、GNOME 原生界面、CLI/TUI 的视觉重构。
- Agent 采集逻辑、Hub 数据库、服务端 API、权限或认证模型变化。
- 真正的多中枢注册表；当前 `HubViewModel[]` 仍然只映射既有单中枢契约。
- 新增远端设备写权限、远端 Agent 控制或把 Web 伪装成本机管理端。
- 更换 React、Next、Electron、Recharts 或引入另一套 UI 框架。
- Google 品牌资产、Google Sans、Material Symbols 在线字体或任何依赖公网字体的资源。

### 3.3 “功能不变”的精确定义

所有现有能力必须继续可达且语义不变；可以移动入口、合并重复展示或改为渐进披露，但不得静默删除：

| 能力 | v3 不变量 |
| --- | --- |
| Web 认证 | 仍使用 HTTP-only session 与全局访问密钥；401 清空失效快照并停止实时通道 |
| 实时更新 | Socket.IO 更新、显式刷新和恢复后的重连行为不变 |
| 离线缓存 | 只在桌面可用，必须明确标为缓存及时间，绝不能显示成实时在线 |
| 设备/虚拟机 | 保留类型切换、在线状态、VM 电源状态、宿主机与 Agent 状态区分 |
| 实例管理 | 保留排序、删除、删除确认及 live/authenticated 能力判断 |
| 遥测 | 保留全部时间窗、CPU/内存/GPU/磁盘/网络/风扇/温度/系统/虚拟化存储数据 |
| 局部缺失 | 继续尊重 `availableMetrics`、`enabledMetrics`、`enabledDeviceIds`、`instanceMetricConfig` 和 `unavailableMetrics` |
| 流量历史 | 保留 day/week/month 日历和历史趋势 |
| Widget | 保留布局 version 4、scope/template key、自定义面板、增删改、撤销/重做、保存/放弃、展板模式 |
| 本机 Agent | 仅桌面显示连接、采样、指标、探针、实例、同步、启动/停止/重启与诊断 |
| 设置 | 保留主题、密度、刷新频率、启动项、连接、会话、更新、快捷键与关于信息 |
| 原生桌面 | 保留拖动、最小化、最大化、隐藏到托盘、Mica/opaque fallback 和低资源模式 |
| 安全边界 | Secret 只经主进程/安全 API 写入，不回显；远端设备仍为只读 |

## 4. v3 视觉语言：Google 式克制，而不是 Google 复刻

### 4.1 设计原则

1. **安静画布**：页面背景承担大部分空间，容器只在需要分组或浮层时出现。
2. **一个焦点**：每个页面首屏最多一个主要结论和一个主要行动。
3. **渐进披露**：高级管理、完整图表、Widget 编辑和危险操作按需展开。
4. **导航稳定**：位置用于目的地，命令用于按钮或命令面板，两者不混用。
5. **状态克制**：绿色、黄色、红色只表达状态；正常状态不铺大面积绿色。
6. **内容居中**：阅读型页面限制宽度，监控和布局编辑页面才使用更宽画布。
7. **边界减少**：优先使用留白、字号、背景层级和 divider，不给每块内容都画边框。

### 4.2 设计 token

- 继续使用语义角色：`primary`、`surface`、`surface-container-*`、`on-surface`、`outline-*`、`error/warning/success/info`。
- 浅色为近白灰画布，深色为温和炭灰；避免纯黑、蓝紫渐变、霓虹、发光边缘和装饰性玻璃效果。
- 主强调色继续使用观澜蓝；数据图表允许使用一组低饱和、可区分且在深浅主题都可读的 data palette，不能把状态色当普通数据色。
- 只有菜单、Dialog、Command Palette 和拖拽中的 Widget 使用明显 elevation；普通内容区不使用通用卡片阴影。
- 圆角分级：搜索/选中导航可使用 full/large；页面分组 medium；输入与小控件 small，禁止所有元素同一圆角。
- 间距使用 `4/8/12/16/24/32/48/64` 节奏。普通桌面控件约 40px，触摸目标不小于 44px。
- 字体不新增网络依赖：沿用可离线工作的系统中文字体栈；数值统一 tabular figures。
- 建议字号：状态主结论 36–44px、页面标题 28–32px、区标题 18–22px、正文 14–15px、辅助 12–13px；大标题紧凑行高，正文保持可读行高。

### 4.3 卡片预算

- 1440×900 的总览首屏最多出现两个有明显边界的主要容器。
- 四块等宽 KPI 卡必须移除，改为一行事实摘要或无边界数字组。
- CPU 与内存两个独立 TOP 5 卡合并为一个“资源观察”区域，通过维度切换展示。
- 设置页不得每个设置组都套卡片；使用单列分组、标题、说明和 divider。
- 图表可以有背景容器，但同一硬件分组只建立一层边界，不出现“卡片套卡片”。

## 5. 目标信息架构

### 5.1 主导航

```text
总览          现在是否需要处理
设备          浏览、搜索、筛选和管理全部设备/虚拟机
接入中枢      当前连接、同步和该中枢的实例
────────
本机 Agent     仅桌面且具备能力时出现
设置          始终位于底部
帮助与反馈     低强调文本入口
```

设备名称不再常驻主导航。搜索设备由全局搜索和设备目录承担；最近访问设备可在总览中出现，但不能重新塞回导航栏。

### 5.2 路由

保留所有现有 deep link，并新增设备目录：

- `#overview`：总览。
- `#devices`：新增设备目录。
- `#hub/:hubId`：中枢页，继续兼容当前 `primary`。
- `#device/:deviceId`：设备详情，旧链接不变。
- `#settings/:section`：设置页，旧链接不变。

`apps/web/src/app/devices/[deviceId]/page.tsx` 仍能直接打开相同设备详情。新增路由必须覆盖 hash 解析、序列化、浏览器前进/后退和未知路由回退测试。

### 5.3 自适应导航

| 窗口级别 | 导航 | 内容 |
| --- | --- | --- |
| Large `>=1200` | 240–264px 展开 Drawer，只显示目的地 | 总览/设置居中，设备详情可用宽画布 |
| Expanded `840–1199` | 80–88px Navigation Rail，hover/title 可解释 | 双栏按内容降为单栏，不压缩文字 |
| Medium `600–839` | Rail 或 Modal Drawer，默认不占大面积 | 单主列；表格转紧凑列表 |
| Compact `<600` | 顶部 App Bar + 仅含目的地的 Bottom Navigation | 16px gutter，安全区适配，单列 |

Compact 底栏只允许 `总览 / 设备 / 中枢 / 设置`。刷新放入顶部按钮或下拉菜单，搜索使用顶部图标打开全屏/底部搜索面板，“置顶”不再作为全局导航项。

### 5.4 应用壳层

- Electron 原生标题栏继续保留拖动区和窗口控制，但只承担原生窗口身份。
- Web 顶部栏显示观澜品牌；Electron 已在原生标题栏显示品牌时，不在侧栏再次重复大号品牌块。
- 工作区 Top App Bar 不再显示当前路由标题；它只承载全局搜索、连接/同步状态、刷新和会话/更多菜单。
- 页面标题只在页面内容区出现一次。
- 搜索在宽屏显示为居中的宽输入触发器；窄屏显示图标，继续支持 `/` 与 `Ctrl/⌘+K`。
- 外观入口移回设置，不能在每页顶部永久占位。

Large 总览骨架：

```text
┌──────────────────────────────────────────────────────────────────────┐
│ 全局搜索设备或命令                         已连接 · 21:05   刷新  ⋮ │
├──────────────┬───────────────────────────────────────────────────────┤
│  总览        │  系统状态                                             │
│  设备        │  所有设备运行正常                                     │
│  接入中枢    │  4 个普通设备 · 4 在线 · 0 待处理 · 21:05 同步       │
│              │                                                       │
│              │  [仅异常时出现的处理清单]                             │
│              │                                                       │
│              │  最近设备 / 需要关注                     查看全部 → │
│              │  ─────────────────────────────────────────────────   │
│              │  工作站        在线      CPU 6.6%       内存 90%    │
│              │  NAS           在线      CPU 99.4%      内存 54%    │
│              │                                                       │
│ 本机 Agent   │  资源观察       CPU | 内存 | 磁盘        最近 5 分钟 │
│ 设置         │  [一张排行/趋势组合，而不是多张重复卡片]             │
└──────────────┴───────────────────────────────────────────────────────┘
```

## 6. 页面级重构

### 6.1 Web 登录与会话加载

当前左右分栏的宣传式登录页改为克制的单焦点登录：

- 顶部保留观澜品牌和简短“设备状态中枢”说明。
- 主体使用最大宽度约 440–480px 的居中表单，不再放大段营销文案和三块能力指标。
- 页面只保留标题、访问密钥字段、主要登录按钮、安全会话说明和必要错误。
- 加载态与登录态使用相同骨架，避免页面跳变；不使用无限旋转器，使用稳定的线性进度/骨架。
- 401、网络失败、登录成功后快照拉取失败必须给出不同且可行动的文案。
- 密钥不得写入 URL、localStorage、日志或错误文本。

### 6.2 总览 `#overview`

首屏顺序固定为：

1. 页面标题与一句健康结论。
2. 无边界事实摘要：当前实例、在线、待处理、最近同步。
3. 仅在异常时出现的处理清单，按连接失效/缓存、离线设备、本机 Agent 问题排序。
4. 最近设备或需要关注的设备，最多 5–6 行，提供“查看全部设备”。
5. “资源观察”区域：CPU/内存/磁盘维度切换，复用现有排行数据；文案改为“负载较高的设备”，不用英文 `TOP 5`。
6. “趋势预览”区域：CPU/内存/存储/网络一次只显示一个主图，维度切换后复用现有 `overviewMetrics`；全部数据仍可访问，但不再首屏同时挂四张图。

约束：

- 中枢状态未知时，待处理数显示“无法判断”，不能算作 0。
- 高 CPU/内存只能称作资源观察或排行，除非后端有明确阈值，不得自行宣称告警。
- 正常状态不要显示大面积绿色容器，只使用文字和小状态标记。
- 刷新入口只保留在全局顶部；若异常清单需要“重试”，该按钮必须是上下文动作。

### 6.3 设备目录 `#devices`

把侧栏与总览中的完整清单职责集中到一个页面：

- 顶部为搜索字段、`普通设备 / 虚拟机` 分段控件、`全部 / 在线 / 离线` filter chips 和排序菜单。
- 宽屏为简洁表格/列表；窄屏为两行设备条目，不强行保留所有列。
- 默认列：设备身份、状态、CPU、内存、磁盘、最后心跳；VM 显示电源状态与宿主机信息。
- 点击整行进入详情，键盘 Enter/Space 等价；行内按钮不得嵌套在 `role=button` 中造成冲突。
- 行末只显示一个 overflow 菜单。删除只在 live + authenticated 时出现，继续使用明确的确认 Dialog。
- 排序进入“管理顺序”模式后才显示拖拽手柄或上/下移动；保存/取消固定可见，默认浏览态不显示箭头。
- 缓存状态为只读，菜单要解释为何不能管理，而不是静默消失。
- 设备列表较长时先使用稳定分页/渐进渲染；没有实测需要前不新增虚拟列表依赖。

### 6.4 中枢页 `#hub/primary`

- 顶部只显示一次中枢名称、endpoint、连接状态与最近同步。
- 使用一行无边界事实展示实例数、在线数和数据来源。
- 下方复用设备目录列表组件，并固定当前中枢范围。
- Web 只显示会话和当前站点信息；桌面才显示连接地址/密钥管理入口。
- 不在 UI 中构造不存在的多个中枢，也不增加假切换器。

### 6.5 设备详情 `#device/:deviceId`

页面分为三个稳定层级：

1. **身份与状态**：`设备 > 主机名` breadcrumb、在线/电源状态、OS、Agent 版本、最后心跳、数据来源。
2. **即时摘要**：CPU、内存、磁盘、网络四个无边界读数；GPU/温度只在可用时出现，局部缺失使用“无法获取数据”。
3. **详情工作区**：sticky tabs + 时间范围 + 内容。

保留现有 panel ID 和布局 scope，显示名与入口可重组：

| 现有 ID | v3 展示 | 说明 |
| --- | --- | --- |
| `overview` | 概览 | 关键趋势与系统事实 |
| `compute` | 算力与内存 | CPU 实例、频率、温度、内存层级 |
| `storage_net` | 存储与网络 | 磁盘、虚拟化存储池、I/O、网卡、流量 |
| `gpu_thermal` | GPU 与温度 | GPU 实例、驱动、负载、显存、温度 |
| `fan` | 风扇 | 风扇 RPM、通道与相关传感器 |
| `all` | 全部指标 | 放入更多菜单或末尾，不抢占常用 tab |
| custom panel | 用户名称 | 名称、顺序和已保存布局保持不变 |

交互要求：

- 时间范围紧邻图表工作区并可 sticky，不放在页面最顶层。
- “编辑布局”从更多菜单进入显式模式；进入后才显示 Widget drawer、尺寸、拖拽、撤销/重做、保存/放弃。
- 退出编辑、切换设备、切换 panel 和关闭页面时继续拦截未保存草稿。
- 展板模式从更多菜单进入，保留全屏、退出按钮、low-resource 和 `chartPointLimit` 约束。
- 远端设备不显示本机 Agent 操作；本机设备的启动/停止/探测仍按 capability 和身份判断。
- 图表组使用一层 surface + divider；不要为设备组、Widget、图表再各套一层边框。
- 同一 tab 只挂载其实际内容；`all` 模式按区块延迟渲染，避免一次创建全部图表。

### 6.6 设置

- 设置继续拥有独立分类导航，但不再与设备清单混在同一个 Sidebar 状态中。
- Large/Expanded：左侧二级设置导航，右侧最大宽度约 760–880px 的单列内容。
- Compact：先显示分类列表，进入分类后使用返回按钮和单页设置，不用横向挤压 tabs。
- 设置项使用“标题 + 说明 + 控件”的平面 row 和 divider；同组只保留一个外层 section。
- Desktop 分类：通用、外观、中枢与连接、本机 Agent、数据与更新、快捷键、关于。
- Web 分类：工作台、外观、会话安全、数据与更新、快捷键、关于。
- 连接密钥、停止上报、退出会话等危险操作与普通偏好分区，并继续使用确认和进行中锁定。
- 返回设置前页面的 `returnRoute` 行为必须保留。

## 7. 统一交互规则

### 7.1 目的地与命令

- Navigation Item 只切换页面。
- Button 执行刷新、保存、重试等命令。
- Filter Chip/Segmented Control 只改变当前集合或图表维度。
- Tabs 只切换同一设备内的内容视图。
- Overflow Menu 承载低频、管理和危险动作。

### 7.2 状态反馈

- 加载：结构匹配的 skeleton，避免整个页面替换成一块空卡。
- 空数据：说明为什么为空、影响什么、下一步是什么。
- 缓存：固定显示缓存时间和只读边界。
- 离线：保留最后样本但明确新鲜度。
- 局部缺失：只影响对应指标，不让整页变成错误态。
- Mutation：提交控件锁定并保留内容；成功 Snackbar，失败 inline message + 可重试。
- Session expired：停止 realtime，顶部持续提示并给出重新认证；不能把过期数据标成 live。

### 7.3 键盘与触摸

- 保留 `/`、`Ctrl/⌘+K`、`Ctrl/⌘+B`、`Ctrl/⌘+,`、F5/Ctrl/⌘+R 和 Escape。
- Tab 顺序与视觉顺序一致；所有 focus ring 在深浅主题可见。
- Tabs/Segmented Control 支持方向键、Home/End；Menu 支持上下键和 Escape。
- Dialog/Command Palette 锁定焦点并在关闭后恢复到触发器。
- 触摸目标至少 44×44px；图表横向手势不能阻断页面纵向滚动。
- `prefers-reduced-motion` 下关闭非必要位移、旋转与 stagger。

## 8. 代码重组方案

不能创建第二套 v3 Renderer、URL 开关或长期 legacy fallback。应在同一个 `WorkspaceApp` 生产入口内逐步抽取和替换。

建议目录：

```text
packages/console-ui/src/workspace/
├─ WorkspaceApp.tsx                 # 只组装 Provider + Frame
├─ state/
│  ├─ WorkspaceContext.tsx          # 数据与 mutation；保留 adapter 边界
│  ├─ WorkspaceUiContext.tsx        # route、nav、theme、density、dialog
│  ├─ routes.ts                     # hash parse/serialize
│  └─ selectors.ts                  # 健康摘要、排行、设备行 view-model
├─ shell/
│  ├─ WorkspaceFrame.tsx
│  ├─ NativeTitleBar.tsx
│  ├─ AppTopBar.tsx
│  ├─ PrimaryNavigation.tsx
│  ├─ CompactNavigation.tsx
│  └─ CommandPalette.tsx
├─ pages/
│  ├─ OverviewPage.tsx
│  ├─ DevicesPage.tsx
│  ├─ HubPage.tsx
│  ├─ DevicePage.tsx
│  └─ settings/
├─ components/
│  ├─ primitives/                   # Button/IconButton/Surface/Field/Menu/Dialog
│  ├─ DeviceList/
│  ├─ StatusSummary/
│  └─ telemetry/
├─ WidgetLayout.tsx                 # 先保持 contract，后续只拆文件不改存储格式
└─ styles/
   ├─ tokens.css
   ├─ shell.css
   ├─ navigation.css
   ├─ components.css
   ├─ pages.css
   ├─ telemetry.css
   └─ responsive.css
```

目录名可在不改变责任边界的前提下微调。实施要求：

- `WorkspaceApp.tsx` 最终只做装配，不继续容纳整页实现。
- 统一到一套 primitive；移除重复 `Button/M3Button` 与 `Surface/M3Surface` 的长期并存。
- 页面组件不直接访问 IPC、Web API 或 secret；仍然只依赖 Context/selector/adapter。
- `selectors.ts` 使用纯函数生成健康摘要、资源排行和显示行，必须有 fixture 单元测试。
- 高频实时 snapshot 与低频 UI 状态尽量拆分 Context 或使用稳定 selector，避免一次设备更新使设置页和全部图表重渲染。
- `workspace.css` 作为 Web/Electron 稳定导入入口不变；内部 CSS 改为单一 selector owner。
- 不在旧 CSS 尾部继续追加 v3 override。每迁移一个页面就删除其旧 selector，最终移除无引用样式。
- 旧 `apps/web/src/components/legacy/**` 继续保持归档且不可重新接入生产 route。

## 9. 数据与持久化防护

以下项在重构前后必须做 fixture 回归，不允许以“UI 能打开”代替：

- `ConsoleAdapter`、`WEB_CAPABILITIES`、`DESKTOP_CAPABILITIES` 的字段和行为不变。
- `ConsoleSnapshot` 请求继续携带 `selectedDeviceId`、`metricWindow`、`trafficMode`。
- Web Socket 的 subscribe/unsubscribe 和恢复后重连不产生重复 listener。
- localStorage 的主题、密度、刷新频率继续迁移；废弃 sidebar 状态时只做向后兼容读取，不删除其他键。
- Widget `scopeKey`、`templateKey`、panel ID、布局 version 4 和用户自定义 catalog 原样保留。
- 设备删除/排序仍由 adapter 完成，不能在 UI 中先永久修改后端事实。
- 本机 connection secret 只走 `saveHubConnection` / 安全 bridge，不进入 React snapshot 明文。
- 远端配置永远不可写；本机身份匹配失败时不显示本机操作。
- 本次不需要数据库 migration；若实现过程中发现必须改 API/schema，应立即停止扩张范围并单独报告。

## 10. 实施阶段

### Phase 0：可回归基线

- 重新检查 Git 状态与现行版本。
- 为 Web 视觉测试建立确定性的 authenticated rich fixture：普通设备、VM、离线设备、局部缺失指标、排行与趋势。
- 保留空/401/cache/error fixture；Electron 增加仅在 `NODE_ENV=test` 且显式环境变量开启的视觉 fixture，生产构建不能激活。
- 先记录 v0.2.315 的关键截图与 DOM/交互断言，证据上传 Actions artifact，不把临时截图提交进仓库。

完成标准：测试能真正进入总览、设备详情、设置与登录状态，而非只断言空壳存在。

### Phase 1：无视觉变化的拆分

- 拆出 routes、selectors、shell、pages 和 primitives。
- 保持当前 DOM/行为到 CI 通过，再开始布局替换。
- 给 route、健康摘要、设备筛选/排序、capability gating 和 widget key 添加测试。

完成标准：共享入口、adapter、深链、实时更新和 Widget 保存契约均未变化。

### Phase 2：token、primitive 与壳层

- 完成单一 primitive 系统、v3 token、Top App Bar、目的地主导航和各断点导航。
- 新增 `#devices`，移除侧栏设备清单与移动端命令型底栏。
- 去除 WindowBar / Sidebar / TopBar / PageIntro 的重复品牌和标题。

完成标准：所有 route 可达，Web/Electron 壳层无横向溢出，键盘导航成立。

### Phase 3：总览、设备目录和中枢

- 按第 6 节重做三页。
- 把管理动作移入显式模式/overflow。
- 把四图和双排行合并为渐进披露区域。

完成标准：所有现有设备管理和 overviewMetrics 数据仍可访问；缓存/live/unknown 文案正确。

### Phase 4：设备详情与 Widget 工作模式

- 重排身份、即时摘要、tabs、时间范围和遥测分组。
- 维持所有 panel/layout key，完成显式编辑模式、未保存保护和展板模式入口。
- 优化 active tab 挂载和 low-resource 情况。

完成标准：所有硬件类别、局部缺失、VM、流量日历、自定义面板与布局保存均有行为证据。

### Phase 5：设置、登录与状态面

- 完成 Web 单焦点登录。
- 完成 Desktop/Web 能力不同的设置分类与 compact drill-in。
- 统一 Dialog、Menu、Snackbar、inline banner、loading/empty/error/cache/offline/session-expired。

完成标准：Desktop 不丢本机能力，Web 不越权显示桌面设置，会话恢复可用。

### Phase 6：视觉、无障碍与性能收口

- 删除旧 CSS 和无引用组件，不保留“v3 override”补丁层。
- 完成主题、密度、触摸、键盘、reduced motion、long text 和低资源检查。
- 完成两轮截图审查；第二轮必须验证第一轮问题已修复，而不是重新提交同一张图。
- 更新历史文档状态，避免旧路径和旧完成结论继续误导。

完成标准：满足第 11 节矩阵，且审查报告逐项链接到 Actions run/artifact。

### Phase 7：版本与测试版发布

- 将根 `VERSION`、根 `package.json`、`apps/server`、`apps/web`、`apps/desktop`、`packages/shared`、`packages/console-ui` 同步为 `3.0.0`。
- Android 从根 `VERSION` 生成 versionName/versionCode；当前计算方式支持 major 3，但仍由 CI 验证。
- 新建 `release-notes-v3.0.0.md`，明确这是共享 Web/Electron UI 大改、API/数据契约不变的测试版。
- 只运行本地允许的静态检查和 Git 操作；不得本地运行 pnpm/Gradle/Go build、测试、打包、Docker 构建或部署。
- 提交并推送 `main`，创建并推送 `v3.0.0` tag。
- 等待 `ci.yml`、`release-test.yml`、`docker-publish.yml` 的相关 job 完成；确认 prerelease 与全部命名资产。
- 下载 `DeviceStateConsole-Windows-GUI-Setup-v3.0.0.exe`，校验后在本机静默安装并验证版本、启动、窗口和关键操作。
- 不更新 `latest`，不触发 production deployment。

## 11. CI 与验收矩阵

### 11.1 必须由 GitHub Actions 完成

- 版本一致性、边界脚本、adapter contract、server/Go/共享 UI 测试。
- Web、Electron、Windows、Linux、Android 的构建与打包。
- Web/Electron Playwright 行为与视觉测试。
- 测试版 Release、固定版本 Docker image 和资产校验。

### 11.2 视觉证据矩阵

至少覆盖：

| 页面/状态 | 1440×900 | 1024×768 | 820×900 | 390×844 |
| --- | --- | --- | --- | --- |
| Web 登录/错误 | 浅+深 | 浅 | 浅 | 浅+深 |
| 总览 live rich data | 浅+深 | 浅 | 深 | 浅+深 |
| 总览 offline/cache/empty | 至少一种 | — | 至少一种 | 至少一种 |
| 设备目录 + 管理模式 | 浅 | 浅 | 深 | 浅 |
| 普通设备详情 | 浅+深 | 浅 | 深 | 浅 |
| VM + unavailable metrics | 深 | — | 浅 | 深 |
| Widget 编辑/Drawer/脏草稿 | 浅 | 浅 | — | 深 |
| 设置 Desktop/Web | 各一套 | 浅 | 深 | 各一套 |
| Command Palette/Dialog/Menu | 浅+深 | — | — | 浅+深 |

截图之外还必须用 Playwright 断言：

- 页面无横向溢出，关键按钮未被遮挡，焦点可见。
- 主导航只包含目的地；compact 底栏没有刷新/搜索/置顶。
- 搜索可打开设备与设置，Escape 关闭并恢复焦点。
- 设备筛选/排序、详情 tab、时间范围、Dialog、设置返回可操作。
- Web 401 后停止 live 状态，重新认证后恢复订阅。
- Widget dirty 状态阻止无确认离开，保存后 scope/template key 未改变。

### 11.3 真实运行时验收

- **CI unit/type/build**：独立记录 PASS/FAIL。
- **Web authenticated E2E**：使用真实测试中枢登录，验证总览、设备、详情、设置和实时更新；没有凭据时标 `NOT RUN`，不能用 fixture 冒充。
- **Electron runtime**：验证真实 preload bridge、原生窗口、托盘、缓存、本机 Agent 和 Mica/opaque；CI headless 不能替代 Windows 实机。
- **Windows setup**：必须使用 Release setup 静默安装并确认 3.0.0 成功启动。
- **Production deployment**：本任务未授权，必须标 `NOT RUN`。

## 12. 防走偏清单

以下任一情况出现，都不能称为 v3 完成：

- 只改色板、圆角、图标或组件名，旧 Sidebar/KPI/Card Grid 原样保留。
- 创建一套新的 v3 预览入口，而生产仍能切回两套 UI。
- Web 与 Electron 分叉为两套页面源码。
- 为了视觉方便删除 Widget、自定义面板、远端只读或本机 Agent 能力。
- 用假多中枢、假用户头像、假告警阈值或静态数字填充页面。
- 用 CSS 尾部覆盖旧布局而不删除旧 selector。
- CI 只截空页面，或者只证明 HTTP 200/构建成功。
- 未核对用户保存布局、认证、缓存、虚拟机与局部缺失数据。
- 将测试版 v3.0.0 当作正式稳定版、更新 `latest` 或部署生产。
- 触碰或提交实施开始时已存在的无关工作区改动。

## 13. 交付给后续审核的材料

实施者完成后必须提供：

1. 变更文件与核心架构说明。
2. 功能对等矩阵，逐项列出 PASS/FAIL/NOT RUN/NOT PROVEN。
3. 两轮视觉审查报告及 Actions artifact 名称。
4. CI、test Release、Docker 固定版本 image 和 Release 资产的 run/link/状态。
5. Windows GUI setup 的文件名、SHA-256、静默安装结果、安装版本和关键页面截图。
6. 未验证项目和已知风险，不能用“应该可用”替代证据。

主对话审核时会优先检查：结构是否真的改变、默认态是否足够安静、所有能力是否仍可达、Web/Desktop 权限边界、Widget 历史数据安全、窄屏可用性，以及测试证据是否覆盖真实数据而非空壳。

## 14. 2026-09-13 完成声明复核

### 14.1 结论

**总结果：FAIL。**

本次复核对象为 `main` / `v3.0.0` 的同一提交 `b76d4f4cef2d6238033ac7d34bbd1d892cb8977c`。实现已经建立新的路由、目的地导航、总览骨架和设备目录，版本、CI、测试版 Release 与固定版本镜像也已生成；但这只是“开始实施 v3”，不是本文件第 1–13 节定义的完整重构。

阻断完成声明的直接事实有三项：

1. 1440×900 的 Web 总览、设备目录和设置页均只显示壳层，主内容完全空白。
2. 总览健康结论基于一个会被“最后打开的设备类型”静默改变的全局筛选，可能漏掉另一类型的离线实例并误报“系统状态正常”。
3. 设备详情、Widget 工作模式、compact 设置导航、架构拆分与完整验收证据均未达到原契约；实现仍依赖旧 CSS 后追加 `workspace.v3.css` 的覆盖栈。

因此，`v3.0.0` 只能保留为存在已知严重缺陷的测试版快照，不得作为“v3 重构完成”基线，不得更新 `latest`，也不得部署生产。返工不得覆写既有 tag；按仓库版本规则，下一次交付应递增 patch 为 `v3.0.1` 测试版。

### 14.2 已确认完成、返工时不得回退的部分

- Web 与 Electron 仍共用 `packages/console-ui`，没有分叉第二套 Renderer。
- 新增 `#devices`，并保留设备详情与设置 deep link 的解析/序列化入口。
- Large 主导航已收敛为目的地，设备清单不再常驻侧栏；compact 底栏为“总览 / 设备 / 中枢 / 设置”。
- 测试脚本已经准备了一组包含普通设备、虚拟机、离线设备与 unavailable metrics 的 Web fixture；问题在于覆盖范围和断言不足，不应删除这组 fixture。
- 根版本与 package manifest 已同步到 `3.0.0`，静态版本检查通过。
- [CI run 34706252974](https://github.com/IGNGserver/guanlan-monitor/actions/runs/34706252974)、[测试版 Release run 34706476405](https://github.com/IGNGserver/guanlan-monitor/actions/runs/34706476405) 和 [固定版本镜像 run 34706476330](https://github.com/IGNGserver/guanlan-monitor/actions/runs/34706476330) 均为 success。
- [v3.0.0 GitHub Release](https://github.com/IGNGserver/guanlan-monitor/releases/tag/v3.0.0) 确认为 prerelease；Windows GUI setup 等命名资产存在。Windows setup 资产为 `DeviceStateConsole-Windows-GUI-Setup-v3.0.0.exe`，发布摘要为 `sha256:bb637f0ff5c4237e817e7352794fa3728568b6f90c292439ce0b4fa882c31171`。

这些 PASS 只证明代码能够在 Actions 中构建、打包和发布，不推翻下面的功能、视觉与实机 FAIL / NOT PROVEN。

### 14.3 P0：必须先修复的阻断问题

#### P0-1：宽屏 Web 主内容被放进零高度网格行

证据：

- `workspace.responsive.css:184-193` 为 `.workspace-root.is-web` 设置 `grid-template-rows: 0 minmax(0, 1fr)`。
- `workspace.v3.css:94-95` 默认把 `.workspace-main` 放在 `grid-row: 1`，只有存在 `.workspace-windowbar` 时才改到第 2 行；Web 没有原生 window bar，因此主内容进入高度为 0 的第一行。
- `workspace.v3.css:215-228` 在 `<=839px` 才把布局改为单列并重新放置 main，所以 390px 截图能出现内容，宽屏截图却为空。
- CI artifact `web-visual-regression-b76d4f4cef2d6238033ac7d34bbd1d892cb8977c`（artifact ID `10302070630`）中的 `web-workspace-desktop.png`、`web-devices-desktop.png` 和 `web-settings-desktop.png` 均只有侧栏/顶栏，没有页面内容；前两张甚至具有完全相同的 SHA-256 `c936091111a516cc366562bc4d740956e0c1dad435559ddf3f8d2e74be04dc3e`。
- `scripts/visual-regression.cjs:240-273` 只断言 root/sidebar/main 的宽度、DOM 数量和 locator `visible`，没有断言 `.workspace-page` 的可见高度、与 viewport 的交集或关键文本所在像素，因此空页面仍被判为 PASS。

返工要求：

- 明确为 Web 和 Electron 定义正确的 grid row，不要继续依赖相互覆盖的旧规则或用截图延时掩盖布局错误。
- 新增 840、1024、1440 三个宽度的 Web 回归；对 `.workspace-content`、当前 `.workspace-page` 和首个主要标题断言非零 rect 且与 viewport 相交。
- 对 `#overview`、`#devices`、`#settings/appearance` 分别断言其专属可见内容，禁止仅以“DOM 存在”代替可见性。
- 截图生成后检测整页有效内容；三个不同路由若得到相同截图应直接失败。

#### P0-2：总览可能隐藏真实异常并误报健康

证据：

- `WorkspaceContext.tsx:568-577` 将 `devices` 和全局搜索先按全局 `instanceType` 过滤。
- `WorkspaceContext.tsx:589-591` 打开任意设备详情时，会把该设备类型写回全局 `instanceType`。
- `WorkspaceApp.tsx:608-620` 的 `V3OverviewPage` 使用过滤后的 `devices` 计算健康摘要、资源排行和趋势，而不是 `allDevices`。
- `selectors.ts:26-42` 只按 `device.status` 计算在线/离线，未把虚拟机电源状态与宿主 Agent 状态分开表达。
- 新总览没有可见的类型筛选器。用户打开一台虚拟机后回到总览，普通设备异常可能从健康结论中消失；反之亦然。

返工要求：

- “系统状态、在线/离线、待处理、最近同步”必须基于 `allDevices` 和完整中枢状态，不能受视图偏好或最后打开页面影响。
- 若资源观察允许按类型过滤，必须提供可见且有名称的局部筛选，并明确只影响该区域；不得影响全局健康结论。
- 虚拟机分别显示电源状态与 Agent/遥测可用性，不能把 `powerState=running`、Agent 在线和指标可用混成一个状态。
- 增加交互测试：在普通设备离线、虚拟机在线的 fixture 下依次打开 VM、返回总览，健康结论和待处理数不得变化；反向场景同样覆盖。

### 14.4 P1：原契约尚未完成的结构与交互

#### P1-1：仍是“旧 UI + v3 尾部覆盖”，架构拆分未完成

- `WorkspaceApp.tsx` 仍有 2651 行，所有整页实现继续挤在同一文件；旧 `OverviewPage`、`MetricTile`、`InstanceRow` 等未使用实现仍然存在。它没有达到第 7 节“只组装 Provider + Frame”的目标。
- `WorkspaceContext.tsx` 仍有 667 行，同一个 Context 同时承载 snapshot、路由、搜索、偏好、所有 mutation 与原生窗口控制；高频数据和低频 UI 状态没有分离。
- 七个工作区 CSS 层仍有 4992 行，`workspace.css:5-11` 按 `tokens → shell → dashboard → telemetry → responsive → m3 → v3` 导入，并将 282 行 `workspace.v3.css` 放在最后覆盖旧规则，直接命中第 12 节禁止项。
- `workspace.v3.css` 没有清理旧摘要卡的 background/border/shadow，Actions 截图仍显示四块有边界 KPI 卡；这不是计划要求的无边界事实摘要。
- `ui.tsx:73-98` 的 `Button` 包装 `M3Button`，但 `WidgetLayout.tsx`、shell 和 widget catalog 又直接使用 `M3Button`；`Surface` 与 `M3Surface` 也长期并存，primitive owner 尚未统一。

返工要求：按第 7 节目录拆出 `pages/overview`、`pages/devices`、`pages/device`、`pages/hub`、`pages/settings` 及共享状态面；删除已替换的旧页面、旧 selector 和死组件。`workspace.v3.css` 不得继续作为总覆盖层，迁移后的 selector 必须只有一个 owner。不要用一个新的 `v3.1.css` 继续叠补丁。

#### P1-2：总览只换了骨架，信息逻辑和视觉仍不合格

- `WorkspaceApp.tsx:669-674` 标题写“最近设备”，数据却只是 `devices.slice(0, 6)`，既没有按最近响应排序，也没有优先展示需要关注项。
- 异常区域只给出聚合文案，没有按中枢断连、设备离线、采集失败、缓存过期形成可定位、可操作的优先级列表。
- `WorkspaceApp.tsx:680` 仍显示英文 `TOP 5`，违反第 6.2 节明确文案要求。
- `WorkspaceApp.tsx:696-704` 趋势固定为 CPU；资源维度切换只作用于排行，没有 CPU/内存/磁盘/网络的一张统一观察区。
- 390px Web 与 1440px Electron artifact 都显示四块独立 KPI 卡，1440px 首屏的明显边界容器数量也超过预算。

返工要求：把总览做成真正的 health-first 页面：一个全局结论、无边界事实摘要、按优先级排列的可操作异常/最近设备列表，以及一张可切换资源维度的观察区；删掉 `TOP 5` 和四卡式 KPI 视觉。

#### P1-3：设备详情基本仍是 v2 布局

- 从 `v0.2.315` 到 `v3.0.0` 的详情页改动主要是壳层衔接和刷新入口调整；`workspace.v3.css` 没有针对 `.workspace-page--device` 的完整新结构。
- `WorkspaceApp.tsx:1859` 仍只有“返回总览”，没有 `设备 > 主机名` 的清晰路径。
- 默认 panel 仍是“综合面板 / 处理器 / 内存 / 显卡与散热 / 风扇转速 / 全景视图”（`WorkspaceApp.tsx:1042-1047`），没有按第 6.5 节重组为摘要事实、少量主趋势与渐进披露的明细。
- 首屏没有稳定的 CPU、内存、磁盘、网络即时事实带；页面仍由大量 Widget/图表卡和旧 tab 构成。

返工要求：落实第 6.5 节的信息架构，保留全部遥测与 Widget v4 数据契约，但重做默认浏览态；普通设备、虚拟机、局部 unavailable metrics、离线缓存均需有独立视觉与行为证据。

#### P1-4：Widget 不是显式、可放弃的编辑工作流

- `WidgetLayout.tsx:1169-1195` 在默认浏览态永久显示“标准 / 极简 / 展板”、编辑排布和添加小组件；“添加小组件”没有受 `editMode` 限制。
- `WidgetLayout.tsx:1151-1156` 点击“完成排布”会自动保存 dirty 草稿，没有明确的“放弃更改”。工具栏也没有独立取消动作。
- 没有 v3 证据证明离开 dirty 页面会确认、保存后 `scopeKey` / `templateKey` / panel ID / layout version 4 不变。

返工要求：默认态只保留一个“更多”入口；进入显式编辑模式后才显示 drawer、拖拽、尺寸、撤销/重做、保存与放弃。保存和放弃必须是两个明确动作；离开 dirty 状态必须确认，并用契约测试核对全部历史 key。

#### P1-5：设备目录的管理顺序存在错误目标风险

- 默认表头只有“设备 / 状态 / CPU / 内存 / 磁盘 / 操作”（`WorkspaceApp.tsx:2181-2183`），缺少计划要求的最后心跳。
- `workspace.v3.css:173-175` 的表头定义七列，而 JSX 只有六个表头，行主体又使用另一组列宽，表头与内容无法形成稳定映射。
- `WorkspaceApp.tsx:2150-2158` 每次上移/下移都会立即调用后端，没有草稿、保存、取消。
- 行按钮的禁用边界用筛选后 `visibleDevices` 的 index/total（`WorkspaceApp.tsx:2185-2191`），实际交换却按 `allDevices` 邻位执行。筛选或按 CPU/内存/名称排序时，用户看到的相邻项和真正被交换的项可能不同。

返工要求：管理模式必须固定为中枢顺序或明确禁止排序/筛选冲突，使用本地 draft，只有“保存顺序”才提交，另有“取消”；表头与行使用同一 grid contract，并补最后心跳、缓存只读说明、删除确认与分页/渐进渲染策略。

#### P1-6：390px 设置分类缺少可发现的进入与返回路径

- `CompactNavigation.tsx:12` 的“设置”只调用 `openSettings()`，直接打开默认分类。
- 分类列表只存在于 `PrimaryNavigation.tsx:32-48` 的侧栏设置导航，`SettingsPage` 自身没有 compact 分类列表或返回分类动作。
- `workspace.m3.css:1194-1198` 在 `<=820px` 隐藏侧边缘触发器，`workspace.v3.css:260-266` 又在 `<=599px` 隐藏顶栏侧栏按钮；因此 390px 用户进入默认设置页后没有可见方式切换到外观、会话、数据、快捷键或关于。
- context 只在本地没有保存值且宽度 `<=820` 时自动收起侧栏，而 v3 的 modal drawer breakpoint 是 `<=839`；断点和持久化状态也不一致。

返工要求：按第 6.6 节实现 compact“分类列表 → 分类详情 → 返回分类”；这个流程不能依赖隐藏手势或桌面侧栏。统一 JS/CSS breakpoint，并测试带有 `dsc-sidebar-collapsed=false` 的旧 localStorage 升级场景。

#### P1-7：中枢页与全局搜索仍未完成

- `WorkspaceApp.tsx:2202` 的空态还写“设备会显示在侧边栏”，与 v3 已移除设备侧栏相矛盾。
- 中枢页没有把 endpoint、连接状态、数据来源、最近同步做成一次性事实头部，设备列表也没有复用设备目录的筛选/只读语义。
- `CommandPalette.tsx:26-34` 仅提供一个平台默认设置入口，并使用已经按 `instanceType` 过滤的 `filteredDevices`；它既不能搜索全部设置分类，也可能漏掉另一类型设备。

返工要求：复用设备目录能力完成中枢范围页，修正文案；全局搜索必须搜索 `allDevices`、主页面和所有当前平台可用设置分类，并验证键盘选择、Escape、焦点恢复和 deep link。

### 14.5 P1：测试与交付证据不足，当前 CI 存在假阳性

当前 Actions artifact 只有 7 张 PNG：

- Web：3 张 1440×900 空内容截图，加 1 张 390×844 浅色总览。
- Electron：1 张 1440×920 空数据总览、1 张空数据设备目录、1 张 390×844 空设备页。

与第 11.2 节矩阵相比，缺少登录/错误、深色、1024、820、rich Electron、普通设备详情、VM、局部 unavailable、Widget 编辑与 dirty、Dialog/Menu、缓存/离线、Desktop/Web 设置差异等证据，也没有第二轮视觉审查。

测试代码同样不足：

- `routes.test.ts` 只有 2 个 test，`selectors.test.ts` 只有 2 个 test。
- Web 脚本只验证命令面板可打开/关闭和壳层结构，没有验证筛选、排序、管理草稿、详情 tab、时间范围、Dialog、设置 drill-in、401 后停止 live、重认证恢复或 Widget dirty/key 保留。
- Electron 脚本直接使用真实 adapter 的空状态，只证明 preload bridge 存在；没有测试专用 rich fixture，也没有证明设备详情、缓存、本机 Agent、托盘、窗口材质和关键操作。
- 仓库中的 `visual-review-round-1.md`、`visual-review-round-2.md` 和 `final-visual-review.md` 仍描述 `v0.2.77–v0.2.79`，不能作为 v3 的两轮视觉报告。

返工要求：完成第 11.2 节的全部视口/主题/状态矩阵，每张截图都必须同时有语义和几何断言；新增实际点击流程而非静态 DOM 数量断言。第一轮发现问题并修复后，再从新的提交生成第二轮 artifact 与报告；报告必须记录 commit SHA、run URL、artifact 名称和每项状态。

### 14.6 P2：一致性与可维护性问题

- `AppTopBar.tsx:8` 只要 session authenticated 就显示在线，即使 snapshot source 为 empty；顶栏状态与页面“等待数据”可能互相矛盾。
- 宽屏 Web artifact 同时在侧栏和顶栏显示“观澜”，信息重复；应按最终壳层层级保留一次明确产品身份。
- 现有 v3 Release notes 不是第 13 节要求的功能对等矩阵、两轮视觉报告与已知风险清单；成功日志不能代替这些材料。
- 返工前必须重新检查工作树。复核时已有不属于本次审核的 `README.md` 修改及 `release-notes-v0.2.104/.105/.106.md` 未跟踪文件，实施者不得覆盖、删除或混入提交。

### 14.7 重新验收状态矩阵

| 验收层 | 当前状态 | 证据/边界 |
| --- | --- | --- |
| 版本一致性静态检查 | PASS | `3.0.0` manifests 一致；返工后必须对 `3.0.1` 重跑 |
| Actions unit/type/build/package | PASS | CI run `34706252974` 成功，但现有测试覆盖不足 |
| v3 结构与操作契约 | FAIL | 第 14.3–14.4 节问题未完成 |
| 1440px Web 运行界面 | FAIL | 三个核心页面主内容空白 |
| Web fixture 行为 E2E | FAIL | visual smoke 假阳性，关键流程未覆盖 |
| 完整视觉矩阵与两轮审查 | FAIL | 仅 7 张、状态/视口/主题严重缺失 |
| Web authenticated E2E | NOT RUN | 没有真实测试中枢登录与实时更新证据 |
| Electron rich-data runtime | NOT PROVEN | 只有空状态 headless 截图与 bridge 存在性断言 |
| 测试版 Release 与命名资产 | PASS | `v3.0.0` prerelease 存在，资产齐全 |
| Windows GUI setup 安装文件/版本 | PASS（仅 Actions runner） | `release-test.yml:164-183` 安装并重装工作流刚构建的 setup，核对文件版本 |
| Windows GUI 实际启动与关键操作 | NOT PROVEN | workflow 没有启动安装后的 GUI；也没有“下载已发布 Release setup → 用户 Windows 静默安装 → 启动 → 截图/操作”的证据 |
| 生产部署 | NOT RUN | 未授权；保持不部署是正确行为 |

### 14.8 返工完成的硬门槛

实施者只能在以下全部满足后再次声明完成：

1. P0-1 与 P0-2 有针对性自动化回归，1440/1024/840 Web 页面真实可见，健康结论不受视图偏好影响。
2. 第 14.4 节七组 P1 均落实到源码和交互，不接受只改文案、颜色、圆角或继续加覆盖 CSS。
3. `WorkspaceApp.tsx` 只负责装配/路由，页面实现已拆出；Context 高频/低频职责已分离；旧页面、死组件和旧 selector 被删除。
4. 设备详情和 Widget 保留全部现有数据/布局契约，并有保存、放弃、dirty 离开保护、scope/template/panel/version 4 的自动化证据。
5. 管理顺序使用 draft + 保存/取消；筛选/排序下不会重排不可见或错误设备。
6. compact 设置分类在 390px 通过可见 UI 完整可达；Web/Desktop 能力边界、401/缓存/离线、VM/unavailable 均验证。
7. 第 11.2 节视觉矩阵补齐并完成两轮审查；脚本会让空内容、零高度、路由截图相同直接失败。
8. 功能对等矩阵逐项使用 `PASS / FAIL / NOT RUN / NOT PROVEN`，不得把 build、fixture、headless 或安装文件存在混写成真实运行时 PASS。
9. 版本递增到 `3.0.1`，只由 GitHub Actions 构建/测试/打包；提交并推送 `main`、创建 `v3.0.1` tag、等待新的 prerelease 与固定版本镜像完成，不更新 `latest`、不部署生产。
10. 下载 **已发布 Release** 的 Windows GUI setup，在用户 Windows 上校验 SHA-256、静默安装、启动 3.0.1，并验证窗口、总览、设备、详情、设置和核心键盘操作后，附上可复核证据。

任何一项未满足，都必须如实保留为 `FAIL`、`NOT RUN` 或 `NOT PROVEN`，不得再次使用“重构已完成”。

## 15. 2026-09-14 第二轮复核（v3.0.15 / c45c060）

### 15.1 复核范围与结论

本轮针对上一轮返工后的当前 main、提交 c45c060、测试版 v3.0.15 复核了共享 Web/Electron 源码、CI artifact、Release 资产、Web 视觉矩阵和 Electron 视觉矩阵。附件中的两张图片继续只作为“简洁、克制、Google 产品式层级”的视觉参考，不把其中的品牌、账号页或具体文案当成功能要求。

结论：仍为 FAIL，不能接受“v3 重构已完成”的声明。

首轮最严重的 P0（宽屏 Web 主内容空白）已实际修复：Web 和 Electron 都能渲染总览、设备目录、详情和设置，1440/1024/840/820/390 的 Web 矩阵有正高度内容；未发现新的 P0 空白阻断。但当前仍有多项 P1 契约问题，且真实认证中枢、用户 Windows 设备和生产运行时没有被证明。因此本轮只能称为“主要壳层修复完成、产品验收未完成”。

### 15.2 已确认通过的部分（不得在返工中回退）

1. 共享入口已变成装配根：packages/console-ui/src/workspace/WorkspaceApp.tsx 只负责 Provider、Frame 和 RouteView，页面已拆到 WorkspacePages、OverviewPage、DevicesPage、DeviceDetailsPage、SettingsPage、HubPage。
2. Web 视觉 artifact 已包含 2 个主题 × 5 个视口 × 4 个路由，共 40 个矩阵单元，以及登录、空数据、会话失效状态；报告检查了页面几何、body 宽度、无水平溢出和路由/主题截图差异。
3. Electron CI 已能渲染 rich fixture 的总览、设备目录、VM 详情、设置和窄窗口页面；Web/Electron 的主导航、compact 底栏和设置返回入口不再把刷新、搜索或置顶伪装成目的地。
4. 命令面板现在从 allDevices 和当前平台可用设置分类取值；设备目录已具备筛选、状态、排序、管理顺序的 draft、保存/取消及删除确认；Widget 基本的保存、放弃、dirty guard、scopeKey/templateKey 和布局 version 4 仍被保留。
5. CI、测试版 Release 和 Windows runner 的安装/启动 smoke 成功。v3.0.15 为 prerelease，命名资产齐全；版本静态检查通过（3.0.15），git diff --check 通过。

证据：

- CI run 34745281871：https://github.com/IGNGserver/guanlan-monitor/actions/runs/34745281871
- Release workflow run 34745283934：https://github.com/IGNGserver/guanlan-monitor/actions/runs/34745283934
- Docker workflow run 34745283927：https://github.com/IGNGserver/guanlan-monitor/actions/runs/34745283927
- v3.0.15 测试版：https://github.com/IGNGserver/guanlan-monitor/releases/tag/v3.0.15
- Web artifact：web-visual-regression-c45c060ad7d1c19fcec922cd2a3db9c031f9e798（40 个矩阵 PNG，报告 screenshotsCount=49）
- Electron artifact：electron-visual-regression-c45c060ad7d1c19fcec922cd2a3db9c031f9e798

上述是 fixture、CI runner 或静态资产层面的 PASS，不等同于真实用户环境的 PASS。

### 15.3 仍未完成的 P1 问题

#### P1-1：设备目录表头与行的 grid contract 仍然错位

- packages/console-ui/src/workspace/pages/DevicesPage.tsx:85-87 只输出“设备 / 状态 / CPU / 内存 / 磁盘 / 操作”六个表头。
- packages/console-ui/src/workspace/pages/shared.tsx:313-320 的行实际包含状态点、身份、CPU、内存、磁盘、最近心跳、箭头七个位置。
- packages/console-ui/src/workspace/workspace.pages.css:69-71 为表头和行分别声明了七列。

因此“状态”会落在身份列附近，“操作”也无法对应最近心跳与箭头；1440px 设备目录截图中可直接看到表头和数据列不对齐。返工必须让表头和行共享同一个列定义/组件，明确显示“最近心跳”，并为窄屏、管理菜单和无数据状态补断言；不能只调整宽度或继续追加覆盖 CSS。

#### P1-2：移动端搜索入口变成无内容的空胶囊

packages/console-ui/src/workspace/workspace.dashboard.css:377-389 使用 .workspace-search-trigger span { display: none; }，会同时隐藏 M3Button 的图标包装和文字；workspace.pages.css:126-128 只预期隐藏 label，但无法抵消前一条规则。390px/820px 截图中搜索按钮仍占据一块圆角区域，却没有放大镜、可见名称或快捷键提示。

这不是“按钮仍可点击”就可以接受的情况：触摸用户无法发现入口，读屏/视觉焦点也缺少可见语义。返工需只隐藏 label、保留搜索图标和 accessible name，重置移动端 min-width/padding，并在 390、820 的截图和键盘/触摸流程中断言图标可见、焦点可见、打开和 Escape 关闭正常。

#### P1-3：Widget 抽屉仍可绕过显式编辑模式

packages/console-ui/src/workspace/widgetCatalog.tsx:1037-1038 在空的自定义面板直接显示“打开小组件抽屉”；packages/console-ui/src/workspace/pages/DeviceDetailsPage.tsx:807 将该入口在可编辑时一直传入。抽屉的 addWidget 在 widgetCatalog.tsx:1142-1168 内部调用 setEditMode(true)，随后调用 addWidget/addWidgetGroup；而 WidgetLayout.tsx:515-541、543-570 的 mutation 只检查 editable/locked，不检查 editMode。

结果是默认浏览态可以从空面板直接打开抽屉并改变草稿，编辑模式不是用户先选择的明确工作流。现有 smoke 只断言工具栏在进入编辑前没有“添加小组件”，没有覆盖空自定义面板入口。返工需二选一但必须保持一致：空态入口先明确进入编辑并显示待保存状态，或在 editMode=false 时完全禁用抽屉和 add mutation；随后补“空面板 → 抽屉 → 添加 → 放弃/保存 → 离开保护”的真实点击测试。

#### P1-4：总览仍违背无边界摘要和单一趋势观察区契约

- workspace.m3.css:1254-1337 仍给四个摘要项设置 border、圆角、surface background 和 elevation；截图显示四块 KPI 卡，和第 6.2 节要求的一行无边界事实摘要相反。
- OverviewPage.tsx:12、:81-85 只支持 CPU/内存/磁盘排行，:99-106 的趋势固定为“CPU 趋势预览”；没有 CPU、内存、磁盘、网络共用的一张可切换主观察区。
- 因此虽然旧的 TOP 5 文案已经移除，首屏层级仍是“多张卡 + 固定 CPU 图”，不是 health-first 的异常优先页面。

返工需删除旧摘要卡的最终样式来源（而不是再覆盖一层），将摘要改成无边界事实组，并让趋势维度切换真正驱动 overviewMetrics；要为网络缺失、无数据、缓存和局部 unavailable 分别提供语义与行为证据。

#### P1-5：中枢页的范围事实和只读目录仍不完整

HubPage.tsx:9 的空态仍写“添加一个中枢后，设备会显示在侧边栏”，与已移除设备侧栏的 v3 骨架矛盾。正常中枢页虽然显示 endpoint 和实例数，但没有把最近同步、数据来源、连接状态组成一次性事实头部，也没有复用设备目录的筛选/只读语义。

同时 WorkspaceContext.tsx:318-325 的 hubState 在 snapshot source 为空但 session.authenticated 时仍可计算为 online；AppTopBar 的 source 判定已较严谨，HubPage 却可能显示“连接正常”，造成页面间状态不一致。返工需按 source（live/cache/empty/error）和认证双重判定，修正文案，复用目录行/筛选能力，并覆盖实时、缓存、空、错误四种中枢状态。

#### P1-6：设备顺序 draft 离开页面时没有保护

DevicesPage.tsx:34-61 已有本地 orderDraft、保存和取消，但 WorkspaceContext/useWorkspaceUiState 的 navigate 只调用 confirmDiscardWidgetLayoutDraft，没有询问未保存的设备顺序。用户在管理模式移动设备后点击侧栏/底栏，草稿会静默丢失；实时设备列表变化时，旧 orderDraft 也可能与新 serverOrder 不一致。

返工需增加独立的设备顺序 dirty guard，统一路由、返回、设置跳转和窗口关闭路径；处理 live 更新时的 ID 合并/冲突，并补“移动 → 导航 → 取消离开/确认离开 → 保存后再导航”的流程测试。

#### P1-7：VM 电源状态和健康结论的覆盖仍不足

当前 DeviceRow 已把 VM 电源状态与宿主 Agent 状态分开显示，健康 selector 也改为使用 allDevices，这是首轮 bug 的有效修复。但 fixture 只覆盖 running VM、普通在线/离线设备和局部指标缺失，没有 stopped、paused/suspended、unknown power state 与“无实时数据但已认证”的组合。

因此“在线数、离线数、待处理事项”在真实 VM 场景下是否不会误导仍然 NOT PROVEN。返工需补这些 fixture 和 selector 单元测试，明确“宿主 Agent 在线”“VM 电源运行”“最近心跳过期”“指标不适用”四种语义，不能用一个 status 字段代替。

### 15.4 P2：架构、响应式和可维护性问题

1. WorkspaceContext.tsx 仍约 402 行、WorkspaceContextValue 仍包含约 92 个字段；高频 snapshot、路由/UI 偏好、能力和 mutation 仍通过一个大 Context 传递。页面拆分已通过，但 Context 高频/低频分离尚未完成。
2. pages/shared.tsx 约 1097 行，承载大量页面专属组件；workspace.css 仍按 tokens、shell、dashboard、telemetry、responsive、m3、pages、details、settings 叠加旧层，summary 的旧/新样式同时存在。应在行为稳定后删除死 selector 和重复 primitive owner，而不是继续扩大覆盖栈。
3. instanceType 在 Context 仍过滤 devices/filteredDevices，但总览使用 allDevices；设置里的“默认实例类型”没有持久化，也没有改变打开总览时的可见范围，属于死设置或未完成契约。filteredDevices 也已不是命令面板的数据源。
4. workspace.dashboard.css 使用 820px 的 JS/旧规则，workspace.pages.css 使用 839px 的 drawer 断点；821-839px 可能出现持久化展开状态与 modal drawer 逻辑不一致。必须补 821、830、839 的边界测试。
5. DeviceDetailsPage.tsx 约 259 行附近存在重复 previousDeviceIdRef.current 赋值，属于可清理的低风险代码味道。

### 15.5 交付与真实运行证据边界

当前 Web/Electron visual scripts 对 API 和数据使用确定性 fixture，所有 40 个 Web 矩阵和 rich Electron 截图都不能证明真实登录、Socket 实时更新、缓存恢复、本机 Agent、托盘或权限边界。Web authenticated E2E 仍是 NOT RUN。

Windows Release workflow 的启动步骤明确设置 NODE_ENV=test、DSC_VISUAL_FIXTURE=1、DSC_RELEASE_ACCEPTANCE_DEVICE_ID=visual-vm（.github/workflows/release-test.yml:193-209），所以它证明的是“已安装的 runner 包可用 fixture 启动并完成路线 smoke”，不是用户 Windows 上的真实中枢运行。Windows-GUI-Release-Launch-Evidence-v3.0.15.json 只记录几何、截图文件名、键盘搜索和 pageErrors；Upload Windows assets（:271-284）只上传 JSON，没有上传 JSON 引用的 PNG，Release 页面无法独立复核这些画面。

状态必须拆开记录：

| 验收项 | 状态 | 说明 |
| --- | --- | --- |
| Web 1440/1024/840/820/390 主内容可见 | PASS | v3.0.15 Web 矩阵 artifact，fixture 数据 |
| Web/Electron 路由壳层和基础导航 | PASS | CI fixture smoke |
| 设备目录表头/行语义 | FAIL | 七列行与六项表头错位 |
| 移动端搜索可发现性 | FAIL | 390/820 截图为空胶囊 |
| Widget 严格编辑边界 | FAIL | 空态抽屉可隐式进入编辑 |
| 总览无边界摘要/可切换趋势 | FAIL | 仍为四块有边界摘要，趋势固定 CPU |
| 中枢页事实头部与状态一致性 | FAIL | 文案、只读目录和 empty+authenticated 状态未闭合 |
| 设备顺序离开保护 | NOT PROVEN | 未有导航 dirty 流程 |
| VM power/unavailable 全语义 | NOT PROVEN | 缺 stopped/paused/unknown fixture |
| Web authenticated E2E | NOT RUN | 没有真实测试中枢凭据/实时证据 |
| CI build/typecheck/package | PASS | run 34745281871 |
| v3.0.15 prerelease 与命名资产 | PASS | Release 资产存在且为 prerelease |
| Windows runner 安装/重装/fixture 启动 | PASS（限定） | 仅证明 Actions runner + fixture |
| 用户 Windows 安装、真实中枢、Agent、托盘 | NOT PROVEN | 未在用户机器完成 |
| Release PNG 可复核性 | FAIL | JSON 引用截图未随 Release 资产上传 |
| 生产部署 | NOT RUN | 未授权，保持不部署 |

### 15.6 v3.0.16 返工硬门槛

下一轮只能递增 patch 到 3.0.16，不得覆盖 v3.0.15，也不得修改工作树中与本任务无关的 README.md 和 release-notes-v0.2.104/.105/.106.md。完成声明前必须同时满足：

1. 修复 P1-1 至 P1-7，并让每项都有源码证据和实际点击/键盘回归，不接受只改颜色、圆角、文案或追加覆盖 CSS。
2. 总览最终只保留健康结论、无边界事实摘要、异常/最近设备和一张可切换 CPU/内存/磁盘/网络观察区；设备目录表头/行共享列契约。
3. Widget 只能在明确编辑模式增删改；保存、放弃、dirty 离开保护和 version 4/scope/template/panel key 均有自动化证据。
4. 390px compact 设置、搜索、设备顺序管理、Dialog/Menu、缓存/离线/401、VM power state、unavailable metrics 和 821-839px 边界全部有可见 UI 与行为证据。
5. 视觉脚本必须对空内容、零高度、表头错位、不可见搜索图标、路由截图相同、主题未变化直接失败；矩阵 artifact 需包含两轮报告、commit SHA、run URL、artifact 名称和 PNG。
6. 真实 Web authenticated E2E、真实 Windows 安装/启动和用户中枢运行要分别标 PASS/NOT RUN/NOT PROVEN，不能用 fixture、headless、安装文件存在或 CI 成功冒充。
7. 仍遵守仓库 AGENTS.md：只由 GitHub Actions 构建、测试、打包和发布测试版；提交 main、推送 v3.0.16 tag、等待 workflow/Release/固定版本镜像完成，不更新 latest、不部署生产。若无法取得真实 Windows 或中枢证据，必须明确保留 NOT PROVEN。

### 15.7 给下一位 AI 的一句话返工提示词

请严格依据 docs/ui-rebuild/refactor-task-v3.md 第15节，把当前 v3.0.15 返工为 v3.0.16：修复设备目录七列表头错位、390/820px 隐形搜索、Widget 绕过显式编辑、四块有边界摘要与固定 CPU 趋势、中枢页状态/只读目录、设备顺序离开保护及 VM power/unavailable 语义，清理重复 CSS/死设置并补齐真实交互和两轮视觉矩阵（含 PNG、报告、SHA/run/artifact 证据），严格区分 fixture 与真实 E2E，遵守 AGENTS.md 仅经 Actions 发布测试版且不得覆盖无关脏文件。

## 16. 2026-09-14 交付前代码审查与返工要求（针对 v3.0.16 未闭合项）

### 16.1 审查结论

**总状态：FAIL / INCOMPLETE（未完成且不可直接发布）。**

前序 AI 对第 15 节提出的 P1-1 至 P1-7 进行了核心组件层面的源码调整，但该轮工作在中途因模型额度耗尽中断，**尚未完成自动化测试用例、视觉回归脚本断言以及版本发布流程**。此外，源码中尚存以下几处具体 Bug、遗留缺陷与未符合契约之处：

1. **Bug：`OverviewPage.tsx` 中的观察指标与无边界趋势图（P1-4 遗留）**
   - 虽然重构了单一资源观察区并去除了 `TOP 5`，但其内部依然保留了旧的 `workspace-overview-grid--split` 样式类与部分旧选择器。
   - `overviewMetrics` 的 CPU/内存/磁盘/网络序列生成中，网络指标 `formatBytes(value) + "/s"` 在无数据（0 或 null）时未对除 0 或异常浮点数进行严格容错；且在 390px 视口下未对趋势切换控件的自适应行高作紧凑化校验。
2. **Bug / 漏洞：浏览器端前进/后退（popstate）与直接修改 hash 绕过设备顺序草稿守卫（P1-6 缺陷）**
   - `packages/console-ui/src/workspace/WorkspaceContext.tsx:153-161` 中的 `popstate` 和 `hashchange` 事件监听器，直接调用 `setRoute(parseWorkspaceHash(window.location.hash))`，未调用 `confirmDiscardDeviceOrderDraft()` 或 `confirmDiscardWidgetLayoutDraft()`。
   - 这意味着用户在浏览器点击“后退”或“前进”按钮、或通过外部 hash 变化时，未保存的设备顺序草稿和 Widget 布局草稿会被静默丢弃，破坏了守卫契约。必须在 `popstate`/`hashchange` 处理时加入草稿守卫拦截或状态回退。
3. **未达标：单元测试与行为测试完全缺失（P1-1、P1-6、P1-7）**
   - `packages/console-ui/src/workspace/selectors.test.ts` 仅验证了简单的状态组合，未针对新增的 `deviceOrderDraft.ts`（`mergeDeviceOrder`、`confirmDiscardDeviceOrderDraft`）编写任何单元测试。
   - 未针对 VM 电源状态组合（`stopped`、`paused`、`suspended`、`unknown` 与 Agent 在线/离线的 4x2 矩阵）及 `selectSnapshotSource` 进行穷尽测试。
4. **未达标：视觉回归与 E2E 脚本未更新（第 15.6 节硬门槛第 5 条）**
   - `scripts/visual-regression.cjs` 和 `scripts/electron-visual-regression.cjs` 完全没有针对“设备目录 7 列表头与行对其”、“390px 搜索按钮放大镜图标与无障碍标签存在且可见”、“未保存顺序离开提示确认”、“Widget 空面板不可隐式编辑”等新增/修复特性加入任何断言。
   - 当前 CI 的测试仍停留在旧版本的通过判定，若直接运行无法证明新修复逻辑的有效性与抗衰退性。
5. **未达标：版本号未递增，发布闭环未启动（AGENTS.md 规范）**
   - 仓库根目录 `VERSION` 及各子包 `package.json` 仍停留在 `3.0.15`，未更新至 `3.0.16`。
   - CI、测试版 GitHub Release、Release 资产与 Windows 安装验收均尚未执行。

### 16.2 必须立即执行的修复与闭环清单

1. **修复 popstate/hashchange 守卫漏洞**：在 `WorkspaceContext.tsx` 的 hash/popstate 监听中正确衔接 `confirmDiscardDeviceOrderDraft` 与 `confirmDiscardWidgetLayoutDraft`，若取消则恢复原 hash。
2. **补齐单元测试**：
   - 新建或在 `selectors.test.ts` 中补充 `deviceOrderDraft.ts` 的合并冲突、删除保留及草稿脏检查测试。
   - 补充 `selectSnapshotSource` 在 `live`（有/无数据）、`cache`、`empty`、`unknown` 状态的完整单元测试。
   - 补充 VM 4 种电源状态 × 2 种 Agent 状态在设备目录与健康统计中的行为测试。
3. **补齐视觉与交互回归断言（`scripts/visual-regression.cjs`）**：
   - 断言设备目录表头与行包含 7 列且列名、尺寸对应。
   - 断言 390px 顶栏搜索按钮保留 `.m3-button__icon` 且 accessible name 为“搜索设备、页面或设置”。
   - 断言空自定义面板在非编辑态下不暴露“打开小组件抽屉”或显示编辑引导，进入编辑排布后才可操作。
   - 断言修改设备顺序后点击目的地导航会弹出确认对话框。
4. **版本递增与验证**：递增 patch 至 `3.0.16`，同步所有 package.json 与 VERSION，通过 `verify-version.mjs`。
5. **按 AGENTS.md 走 Actions 测试发布**：提交 main，推送 tag `v3.0.16`，由 GitHub Actions 构建并生成 Release，下载 Windows GUI setup 资产验证。严禁改动无关的 `README.md` 与旧 `release-notes-v0.2.104/105/106.md`。

### 16.4 2026-09-14 修复实施与验收记录

1. **popstate / hashchange 守卫漏洞已修复**：
   - 在 `WorkspaceContext.tsx` 中引入 `currentRouteRef` 追踪当前路由，监听浏览器 `popstate` 和 `hashchange` 事件。
   - 当检测到目标路由与当前路由不一致时，优先调用 `confirmDiscardWidgetLayoutDraft()` 与 `confirmDiscardDeviceOrderDraft()`。
   - 用户取消离开时，自动使用 `window.history.replaceState` 回退恢复原 hash，彻底封堵前进/后退及直接改 hash 绕过草稿守卫的漏洞。

2. **单元测试与穷尽状态矩阵已补齐**：
   - 在 `packages/console-ui/src/workspace/selectors.test.ts` 中补齐 `deviceOrderDraft.ts`（`mergeDeviceOrder` 排序保留/删除冲突/新增补入，以及 `confirmDiscardDeviceOrderDraft` 守卫注册与确认拦截）。
   - 补齐 `selectSnapshotSource` 覆盖 `live`（有/无数据）、`cache`、`empty`、未认证 `unknown` 的判定测试。
   - 穷尽 VM 4 种电源状态（`stopped`、`paused`、`suspended`、`unknown`）× 2 种 Agent 状态（`online`、`offline`）的 4×2 组合矩阵测试，验证健康统计、目录筛选以及异常优先级排序。

3. **视觉与交互回归断言已补齐**：
   - 在 `scripts/visual-regression.cjs` 中断言设备目录表头与行包含 7 列且列名、列尺寸对齐一致。
   - 断言 390px 顶栏搜索按钮保留 `.m3-button__icon` 且 accessible name 为“搜索设备、页面或设置”。
   - 断言空自定义面板在非编辑态下不暴露“打开小组件抽屉”且展示显式编辑引导，进入“编辑排布”后才暴露操作。
   - 断言修改设备顺序后点击目的地导航会弹出离开确认对话框，取消后留在原页面。

4. **版本递增与验证**：
   - 根目录 `VERSION`、`package.json` 以及所有子 package.json 全部同步递增为 `3.0.16`。
   - 静态检查 `node scripts/verify-version.mjs` 验证通过。

