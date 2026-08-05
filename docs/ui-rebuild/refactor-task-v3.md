# 桌面端 UI 重构开发任务（v3）

## 目标

把 Electron 桌面端收敛为一个可维护的设备工作区：侧边栏顶部是总览，下面按接入中枢分组列出设备；总览只回答“现在是否需要处理”，中枢页回答“这个连接下有哪些设备”，设备页回答“这台设备为什么是这个状态”；侧边栏底部进入设置模式，设置模式拥有自己的分类导航和页面。

视觉方向参考 Codex Desktop 的信息层级和操作逻辑，但不复制其品牌资产、源代码或闭源实现。所有图标使用内联 SVG，产品文案使用中文，默认浅色，支持系统/浅色/深色和舒适/紧凑密度。

## 已完成的生产入口

- `apps/desktop/src/renderer/App.tsx` 只有一个生产入口，不再根据 URL 或 localStorage 切换旧 UI。
- `apps/desktop/src/renderer-guanlan/workspace/` 是唯一的桌面工作区，数据通过 adapter 接入既有 `dscBridge`。
- 路由使用 hash：`#/overview`、`#/hub/:hubId`、`#/device/:deviceId`、`#/settings/:section`，可通过浏览器后退恢复页面上下文。
- `MockGuanlanDataAdapter` 仅在开发环境显式设置 `VITE_DSC_UI_PREVIEW=true` 时启用，生产路径不使用 mock 数据。

## 页面与操作逻辑

### 侧边栏

1. 顶部品牌与折叠按钮。
2. 总览入口，始终可见。
3. 中枢分组：显示连接状态、设备数量和设备行；设备行显示主机名、系统、CPU 概览和在线状态。
4. 底部放置本机 Agent、连接设置、设置和帮助反馈。
5. 折叠后保留图标和可访问的 `title`，窄窗口自动切换为覆盖式侧边栏。

### 总览

- 顶部先显示需要处理的事项数量；没有异常时才显示“所有中枢运行正常”。
- 用设备列表、连接摘要、资源趋势和中枢摘要构成工作区，不使用四块 KPI 卡片堆叠。
- 缓存、离线、Agent 停止、空设备和同步错误必须有明确状态、解释和下一步动作。

### 中枢页与设备页

- 中枢页显示连接地址、连接状态、设备数量和该中枢下的设备列表。
- 设备页显示状态行、CPU/内存/GPU/磁盘指标、遥测趋势、硬件实例和 Agent 操作。
- 远端设备为只读；只有本机设备显示 Agent 控制，不允许把远端配置写操作伪装成可用。

### 设置模式

点击侧边栏底部“设置”后，侧边栏替换为通用、外观、中枢与连接、本机 Agent、数据与更新、快捷键、关于观澜八个分类。设置页不能继续显示设备导航，返回按钮恢复进入设置前的页面。

## 反复出现的旧问题与防复发规则

| 问题 | 防复发规则 |
| --- | --- |
| 旧 UI 与新 UI 并存，靠 URL/localStorage 选择 | 生产入口只允许一个 `WorkspaceApp`；任何旧入口命名进入 CI boundary check 即失败 |
| 用 emoji 代替图标，字体/平台渲染不一致 | 活跃桌面 UI 禁止 emoji；图标只能来自内联 SVG 或经过审计的图标库 |
| 深色霓虹、粗边框、默认阴影导致廉价后台感 | 颜色必须来自语义 token；默认浅色；强调色只用于状态、链接和主要动作；禁止 glow 和渐变装饰 |
| 卡片、横幅、指标重复表达同一件事 | 先设计信息层级和页面任务，再决定 surface；总览最多一个主要注意事项，不堆 KPI 卡片 |
| 固定窗口尺寸导致内容裁切 | BrowserWindow 根据 work area 设置初始尺寸和最小尺寸；CSS 在 1080/820/620 断点切换布局；所有关键文本允许收缩/换行 |
| 把 loading、cache、empty、error 当成同一张空卡片 | 每种状态都要有说明、影响范围、恢复动作和可访问状态语义 |
| 设置项只有视觉控件，未保存真实状态 | 所有控件必须绑定 shared contract 或明确的本地持久化；CI/代码审查禁止无行为的 select/toggle |
| 组件直接依赖 IPC、localStorage 和页面状态 | 页面只依赖 `WorkspaceContext`，Context 通过 adapter 调用 bridge；密钥只走主进程 |
| 远端设备出现本机操作按钮 | 按设备来源区分 read-only/managed capability；远端只显示查看与连接入口 |
| 文案中混用英文、技术错误码和开发者占位语 | UI 文案统一中文；错误码在边界转换为用户能行动的提示；开发/预览文案不得进入生产路径 |

## 开发与验收门禁

1. 新页面先写 route/state/view-model，再写 CSS；不得从旧组件复制 JSX 或 CSS。
2. 每个交互必须有 hover、pressed、focus-visible、disabled、loading 和错误状态。
3. 必须覆盖 1440、1080、820、620 和 390 宽度的无溢出检查；主题和密度至少各检查一次。
4. `node scripts/check-desktop-ui-boundaries.mjs` 必须通过；它会检查旧入口、旧组件名、旧 token 和活跃 UI 中的 emoji。
5. 生产 adapter 只能调用 `dscBridge`；mock 只能由显式开发预览开关启用。
6. 本机不执行项目 build、测试、打包或安装；由 GitHub Actions 完成静态检查、typecheck、构建和测试版 Release，再使用 Windows GUI setup 资产验收。

## 后续扩展

当前 shared snapshot 仍是单一 Hub 数据契约，界面已经用 `HubViewModel[]` 隔离出中枢分组边界。真正支持多个独立中枢前，需要新增中枢注册表、凭据隔离、连接健康状态和带 `hubId` 的设备身份，并保持现有单中枢配置向后兼容；这应作为独立的契约/主进程任务，不通过前端假数据冒充完成。
