# 观澜 Android 客户端 · One UI 设计系统

本文件是安卓客户端按 Samsung **One UI** 重构后的设计契约：token 取值、层级规则、组件语义、
动效时长与适配策略全部在此登记。代码里的唯一来源是
`android/app/src/main/java/com/dsc/android/ui/oneui/`，页面不得自带颜色、圆角、字号或时长。

## 0. 设计理念与依据

One UI 的出发点是「让大屏设备可被单手自然使用」：Samsung 公开说明里强调把常用控件集中到
拇指可及的位置、用宽大的标题把主内容推到竖向中部、并借深色主题降低低光环境下的视觉负担。
自 One UI 6.0 起系统字体为 One UI Sans；One UI 7 做了一次完整的视觉改版；当前稳定版本为
One UI 9（2026-07，Android 17）。

取值分三档，本仓库明确区分，不混为一谈：

| 档位 | 含义 | 例 |
| --- | --- | --- |
| 官方口径 | Samsung 公开描述的原则与特性名 | 内容靠上/控件靠下、One UI Sans、深色降低负担、Extra dark |
| 实测取值 | 对 One UI 界面渲染结果量取/取样的近似值 | `#1B76FD` 强调蓝、24dp 分组圆角、52dp 主按钮高度、动效时长 |
| 本产品推导 | 监控类应用需要而 One UI 未规定的语义 | 在线/离线/告警/图表序列色、指标块、时间粒度选择器 |

Samsung 不公开 One UI 的设计 token（其设计规范不对第三方开放），因此「实测取值」是工程可实现
的对齐结果，而不是官方数值。所有此类值集中在 `OneUiColor.kt` / `OneUiType.kt` / `OneUiLayout.kt`
/ `OneUiMotion.kt`，换值只改一处。

## 1. 形（视觉语言）

**颜色** `OneUiColor.kt`。三套调色板：`OneUiLightColors`、`OneUiDarkColors`、`OneUiExtraDarkColors`。
分层靠色层而不是阴影：页面底 `canvas` → 分组 `group` → 抬升 `raised` → 内凹 `sunken`（图表底、输入框）。
额外暗色为纯黑表面 + 取消投影 + 保留发丝线，对应三星的 Extra dark。状态色一律成对出现
（前景 / 浅底 / 浅底上的文字），保证在深浅两侧都有可读对比。文字三级（primary / secondary / tertiary）
加禁用级；开启系统「高对比文本」时压平为两级并加深发丝线。

**字体** `OneUiType.kt`。使用平台默认字族：三星机型解析结果即 One UI Sans / SamsungOne，
其他机型落到 Noto Sans CJK，中文排版一致。Samsung 字体不可随包分发；拿到授权后把文件放进
`res/font/`，把 `OneUiFontFamily` 换成 `FontFamily(Font(R.font.oneui_sans_regular))` 即可，字阶不动。
字阶按角色定义（19 个角色，见 `OneUiTextRole`），数字统一 `tnum` 等宽，避免 15 秒刷新时数字抖动。

**Shape / Surface / Elevation / Spacing** `OneUiLayout.kt`。圆角阶梯 8/12/16/20/24/28/32 + 胶囊；
按钮与筛选一律全圆胶囊，分组 24，对话框 28，面板顶部 32，底部工具坞只圆上沿两角（`shapes.dock`）。间距基准 4dp，页面留白 20dp（宽屏 28/40），
组与组之间 24dp。`Modifier.oneUiSurface()` 是唯一容器实现，负责「色层 + 可选投影 + 额外暗色下的描边」；
分组、通知条、对话框、胶囊读数、指标块、元信息表都走它——额外暗色下 `group == canvas == sunken` 都是纯黑，
只有这条路能保留发丝描边，页面自己叠 `background()` 就等于把容器抹平。

## 2. 构（信息层级与导航）

| 层级 | 变化 | 理由 |
| --- | --- | --- |
| 连接引导 | 登录页改为引导式：标题在上、说明紧随、字段成组、主行动固定在底部 | One UI 的连接页属于引导流程，不参与一级导航 |
| 一级导航 | 新增 `设置` 目的地，与 `设备` 常驻底部导航；展开态换成同一组目的地的侧栏 | 登出/版本/外观不再塞在列表顶栏 |
| 设备列表 | 每台设备一张卡片：状态点 + 在线文字、指标胶囊行、就近动作 | 保留原 StatChip 的全部读数语义 |
| 设备详情 | 概览组（身份 + 关键读数 + 元信息表）→ 硬件类别列表 → 流量入口 | 由「卡片堆叠」改为「类别可下钻的列表」 |
| 时间粒度 | 从顶栏 FilterChip 下沉为底部工具坞 | 高频切换放拇指区，是 One UI 的核心约定 |
| 类别明细 | 半屏面板：标题 + 粒度说明 + 实例胶囊 + 图表与元信息 | 保留总和/实例的原有 tab 结构 |
| 流量 | 由半屏面板改为整页日历 | 日历 + 明细不适合塞进半屏 |
| 记录项配置 | 由带列表的 AlertDialog 改为底部面板 + 设置式行 + 底部确认条 | 多选配置属于任务流，不是确认框 |
| 长按 | 设备行长按唤出操作面板（打开 / 流量 / 记录项 / 隐藏） | One UI 的上下文操作用面板而非菜单 |

页面代码结构：`ui/shell/`（外壳、目的地、消息通道）、`ui/screens/`（5 个页面 + 配置面板）、
`ui/oneui/`（token、组件、动效、适配）、`ui/oneui/OneUiDomain.kt`（取数与格式化，从旧
`AppRoot.kt` 原样迁出，业务口径未变）。旧 `AppRoot.kt`（3024 行单文件）与其顶栏式导航已删除，
其中已失效的 `CpuSection`/`MemorySection`/`DiskSection`/`NetworkSection`/`GpuSection`/`FanSection`
与 `ColumnScopeScope` 一并清掉。

## 3. 件（组件与语义）

`OneUiInteraction.kt`（状态层）→ `OneUiControls.kt`（文本角色、按钮、图标按钮、开关、勾选、筛选胶囊、
分段选择、输入框）→ `OneUiContainers.kt`（顶栏、底部导航、侧栏、分组、列表行、通知条、胶囊读数、
对话框、面板、操作面板、加载/骨架/空/错、读屏播报区）→ `OneUiDataViews.kt`（折线图、指标块、指标网格、
元信息表、粒度选择器）。

映射关系：One UI 官方组件语义 `AppBar / BottomNavigationBar / ContainedButton / FlatButton /
IconButton / Switch / AlertDialog / PopupMenu / InkRipple` 分别对应
`OneUiTopBar / OneUiBottomBar / OneUiButton(Filled) / OneUiButton(Text) / OneUiIconButton /
OneUiSwitch / OneUiDialog / OneUiActionSheet / oneUiPressable`。

开关与勾选自行绘制（One UI 形态与 Material 默认差别最大：大号圆形滑块、描边空轨道、圆角方框勾选），
但点击与状态语义仍走官方 `clickable(role = Role.Switch/Checkbox)` + `stateDescription`，
选中态另外补 `semantics.selected`，读屏才会念「已选中」而不是只有一段状态文案。
输入框是自己拼的 `BasicTextField`（One UI 的浅底 + 聚焦描边与 M3 `TextField` 差别太大），
但它的 `interactionSource` 必须是页面上真正那一个，否则聚焦态永远不出现。
只有 `ModalBottomSheet` 与 `SnackbarHost` 复用官方实现，并通过 `OneUiColors.toMaterialColorScheme()`
落回同一套 token；面板状态（`SheetState`）在设计层内部创建，页面因此不需要任何
`ExperimentalMaterial3Api` 授权，`Snackbar` 也是设计系统目录之外唯一允许出现的 Material 3 引用。

## 4. 交（操作与状态）

一个可交互表面固定 6 态：普通 / hover / pressed / selected / disabled / focus，全部由
`oneUiPressable` 统一表达——同一支墨色只改透明度（pressed 0.11、hover 0.05、selected 0.08）、
按下整体缩放 0.972、禁用内容 0.38、键盘/触控笔/DeX 焦点出现 3dp 强调色轮廓（画在墨色与底色之上、
边界内侧，否则会被自己那层容器色盖掉）。
不使用 Material 的触点水波（`indication = null`），改为整面墨色，符合 One UI 的实际观感。
触觉分级：轻触 `VirtualPress`、开关 `VirtualRelease`、长按 `LongPress`。
加载态保留文案宽度（按钮内嵌 `OneUiSpinner`）；错误态必须带重试出口；空态必须给出下一步。

## 5. 动（Motion System）

`OneUiMotion.kt` 是唯一动效来源：时长 `110 / 170 / 190 / 220 / 260 / 340 / 390ms` 分档，
曲线 `EmphasizedDecelerate(0.05,0.7,0.1,1)`（进场收尾）、`EmphasizedAccelerate(0.3,0,0.8,0.15)`（退场）、
`Emphasized(0.2,0,0,1)`（形变）；交互反馈用带轻微回弹的 spring，面板用 0.82 阻尼弹性。

落点：页面前进=新页自下方轻微上移 + 1.5% 放大 + 淡入，旧页只淡出且更快结束；后退=镜像；
同页切换（粒度、实例 tab、日/周/月）=横向轻推 + 淡入淡出；列表逐项交错入场（34ms 步进，最多 6 档），
离场统一淡出；分段选择器指示器与进度条数值都走同一支补间（`oneUiAnimatedValue`）；
开关滑块与轨道色同步动画；图表首次出现或切换粒度时描线一次（15 秒自动刷新不重播，
准线选中位置也不因刷新复位）。常驻指示器周期（加载环 820ms、旋转 900ms、不确定进度 1100ms）
同样登记在 `OneUiDuration` 里，页面与组件不得再写裸 `tween(...)`。系统动画缩放为 0（含三星「减少动画」）或用户在设置里开启「减少动画」时，
整套体系降级为瞬时切换，位移量归零。

## 6. 适（适配与无障碍）

- **窗口**：`OneUiWindowLayout` 按 600dp / 840dp 分紧凑、中等、展开，并带高度维度。
  紧凑=底部导航 + 单栏；展开=侧栏 + 列表—详情双栏；矮窗（横屏、分屏、折叠屏外屏）自动把大标题降级为小标题。
  宽屏限制正文行长（720 / 840dp）并居中，不把一行文字拉到屏幕两端。
- **输入**：hover 只在真有指针时出现；键盘/遥控器/DeX 有焦点轮廓；触控命中区 ≥48dp，列表行 ≥64dp；
  只承载读数的胶囊（不可点）保持视觉高度，不硬撑到 48dp。
- **字号**：正文与标签全量跟随系统字号（One UI 支持到 200%），装饰性大标题在 130% 后停止线性放大，
  改为靠换行与纵向堆叠继续提供可读性；行高与图表高度随字号同步放宽，指标网格在窄屏/大字号退化单列。
- **深浅色**：浅色 / 深色 / 额外暗色 / 跟随系统，应用内可覆盖并落盘。
- **无障碍**：在线/离线、已选中、诊断模式等状态始终「颜色 + 文字 + 图标」三重表达；
  图表提供序列摘要（样本数、最低/最高/平均、当前选中值）供读屏朗读；流量日历每格播报「日期 + 总量 + 是否选中」；
  刷新与断线等常驻状态走独立 `liveRegion` 播报区，与 Snackbar 不重复朗读；
  开启系统「高对比文本」时压平文字层级并加深分隔线。

## 7. 验证与后续

本机不执行构建（见 `AGENTS.md`）。编译、单测与 lint 由 `.github/workflows/ci.yml` 的 `android` job
承担（`:app:assembleDebug`、`:app:testDebugUnitTest`、`:app:lintDebug`）。

两类契约由 `android/app/src/test/java/com/dsc/android/OneUiDesignContractTest.kt`（取值与自适应）
和 `OneUiSourceContractTest.kt`（源码扫描：页面不得引用 Material 3、不得自带色值、不得手搓可点击表面、
`groupGap`/`oneUiContentWidth`/`shapes.dock` 等 token 必须真被页面使用）共同守住。
**改设计前先跑这两个类的规则**：把 token 加在定义处却不让页面用上，测试会直接失败。

双栏（≥840dp，平板 / DeX / 折叠屏外屏）的类别明细已改为内联进右栏正文，
单栏仍是半屏底部面板；未登录时不进入双栏，引导页始终占满窗口。

仍待补齐的一项：One UI Sans 授权字体的随包方案（当前回落平台字体）。
