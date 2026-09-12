# Material 3 UI 重构契约

状态：基础层、窄屏外壳、高频控件、页面级状态摘要、设备详情状态面、桌面连接表单和网页会话恢复已落地；最终多端验收按后续阶段推进。

## 目标与范围

本次重构面向当前产品主线：

- Web：`apps/web` 通过 `UnifiedConsole` 使用共享控制台。
- Windows/Linux 桌面：`apps/desktop` 的 Electron renderer 使用共享控制台。
- 共享 UI：`packages/console-ui` 的 `WorkspaceApp`、适配器和工作区样式。

旧 `windows-agent` WinUI 和 `linux-agent-gui` 不属于本轮 React/Electron Material 3 迁移范围。它们如果后续需要统一，需要单独设计原生控件映射，不能把 Web CSS 直接移植过去。

本次只改变表现层和操作编排，不改变数据、权限或平台桥接契约。必须保持以下内容不变：

- `ConsoleAdapter`、`ConsoleCapabilities`、Web API、Electron IPC 和原生窗口能力。
- 登录会话、访问密钥语义、设备 ID、指标字段、缓存和虚拟机电源状态。
- Hash 路由格式、Widget 布局文档、布局 ID、模板、撤销/重做和远程保存接口。
- Agent 上报、Hub 同步和已有权限判断。

## 视觉语言

### 语义颜色

颜色通过 `packages/console-ui/src/workspace/workspace.tokens.css` 定义，不在页面组件中直接写颜色：

- `primary`：观澜蓝，用于主要行动、当前导航和焦点。
- `primary-container`：主要行动的低强调容器。
- `surface` / `surface-container-*`：页面、区域和控件的层级。
- `on-surface` / `on-surface-variant`：正文和辅助信息。
- `outline` / `outline-variant`：控件边界和分隔线。
- `error`、`warning`、`success`、`info`：只表达状态，不作为装饰色。

浅色、深色、系统主题和 Windows Mica 的透明度变化都通过这些语义角色消费。Mica/Acrylic 是平台材质层，不改变 Material 3 的组件语义。

### 排版、形状与动效

- 正文默认保证中文可读性，监控数值使用 tabular figures。
- 使用 4/8 的间距节奏，组件内部间距优先于额外边框。
- 外层容器使用较大的形状，内部控件使用较小的形状，避免所有元素都使用同一圆角。
- 主要控件桌面高度为 40px，触摸输入至少为 44px。
- hover、pressed、focus、disabled 使用统一状态层。
- 动效使用 transform/opacity；低资源和减少动态效果时关闭非必要动效。

## 组件与操作契约

| 场景 | Material 3 组件 | 操作要求 |
| --- | --- | --- |
| 一级页面 | Navigation Drawer / Rail / Bar | 当前页面始终有明确选中态，窄屏使用 Modal Drawer 或 Navigation Bar |
| 页面顶部 | Top App Bar | 详情页提供返回；标题、数据来源和主要操作保持同一层级 |
| 同一页面分类 | Tabs | 支持键盘方向键、Home/End、焦点可见；不把筛选器伪装成页面导航 |
| 时间范围/筛选 | Segmented Control / Filter Chip | 选中值明确，变更后保留当前设备和滚动位置 |
| 普通操作 | Filled / Tonal / Outlined / Text Button | 每个页面最多一个主要行动，危险操作使用独立 danger 语义 |
| 表单 | Text Field / Select / Switch Row | 标签、辅助说明、错误信息和禁用状态必须可读且可关联 |
| 持续问题 | Inline Banner | 说明影响和下一步，不只显示颜色或圆点 |
| 短暂结果 | Snackbar | 告知成功/失败；失败提供重试或进入设置的路径 |
| 删除/停止/丢弃 | Dialog 或 Bottom Sheet | 明确对象、后果、取消和确认；操作期间锁定重复提交 |
| 布局编辑 | 编辑模式 + Drawer/Sheet | 修改后提供保存、放弃、撤销/重做；离开时用应用内 Dialog 确认 |

浏览器 `beforeunload` 的原生提示可以保留，因为它由浏览器接管；应用内的 `window.confirm` 应逐步替换为共享 Dialog。

## 自适应布局

- `compact`：单列内容、Modal Drawer、Navigation Bar，主要操作靠近拇指区。
- `medium`：Navigation Rail 或可展开 Drawer，减少同时显示的辅助信息。
- `expanded`：Drawer + Top App Bar，详情页可使用双栏。
- `large`：完整 Drawer、数据列表和图表并列，但保持单一主滚动区域。

响应式变化只改变布局和可见操作，不改变路由、权限、设备选择和数据含义。

## 迁移顺序

1. 语义令牌与基础组件：按钮、图标按钮、Chip、Segmented Control、Text Field、Switch、Surface。
2. 应用外壳：标题栏、导航、顶部栏、搜索、Snackbar、Dialog 和移动端导航。
   当前已完成窄屏 Navigation Bar、移动端 Modal Drawer 边界、设备详情 Tabs，以及时间范围、刷新频率、主题/密度、开关、Snackbar、命令搜索、Dialog 输入、筛选 Select、Checkbox、硬件探针配置、小组件抽屉操作、布局编辑器工具栏、总览状态摘要、设备详情状态面、无遥测反馈、桌面连接表单校验、共享导航项、窗口控制、网页会话恢复和网页登录表单的 Material 3 交互迁移。
3. 总览：设备列表、状态摘要、异常提示、加载/空/缓存/离线/错误状态。
4. 设备详情：指标 Tabs、时间范围、图表容器、Widget 编辑模式和布局保存反馈。
5. 设置与登录：双栏设置、表单错误、连接状态、Agent 控制和认证恢复。当前网页会话失效会清空过期快照、停止实时通道，并提供重新认证入口；登录表单复用共享 Material 3 Text Field/Button。
6. 键盘、触摸、深色模式、低资源模式、视觉回归和真实 Web/Electron 验收。

每一阶段都保持可独立构建和回滚，不重写适配器或服务端。

## 验收证据

CI 必须执行类型检查、边界检查、构建、共享 UI 行为测试以及 Web/Electron 视觉 Smoke。需要另外记录：

- Web 登录后的总览、设备详情和设置点击链路。
- Electron 启动、IPC、原生标题栏、窗口材质和托盘行为。
- 窄屏、触摸、键盘、深色/浅色和减少动态效果。
- 实时、缓存、离线、空数据、请求失败和未保存布局等状态。

CI 通过或 HTTP 200 不能替代上述已登录和真实运行时验证；未执行的项目必须标记为 `NOT RUN` 或 `NOT PROVEN`。
