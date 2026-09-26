# 网页端前端问题清单与修复计划（2026-09-26）

审计对象：`apps/web`（Next.js 壳）+ `packages/console-ui/src/workspace`（桌面/网页共用的控制台 UI）。
基线：`main` = `b8bcf41`，`VERSION` = 3.0.108。

## 落地结果（同日，v3.0.110 / commit 803e604）

清单里 76 条已全部处理，分三种结局：

**已修**：A1–A16、B1–B11、C1–C14、D1–D11、E1–E9、E12、F1、F2、F4–F8、G 全部。

核心手法不是逐条打补丁，而是把两件本来分散的事各自收成一处：

- **颜色**：`workspace.tokens.css` 末尾新增 `.guanlan-carbon-theme` 映射块，把 `--workspace-*` 整套调色板重定向到 Carbon 在该元素上发出的 `--cds-*`。A3/B1–B10 那一批「M3 圆角灰盒混在 Carbon 直角白盒里」的问题因此一次性消失，且明暗主题不可能再分家。别名必须在这个块里重新声明一遍——`var()` 在自定义属性声明里是在**声明所在元素**求值的，只改基础 role 不会传导到 `--workspace-text` 那类别名。
- **几何**：删掉 `workspace.m3.css` 里那些 `(0,2,0)` 复合尺寸声明，44px 契约回到唯一一处；`dashboard.css`（第 4 层，唯一能反过来压住 coarse 的一层）为图表卡按钮补了 coarse 分支。

**审计自身的两条结论被证伪并已在提交信息里更正**：

1. F7 说「建议改用 `--cds-spacing-*`，carbon.scss 已经在这么做」——错。`@carbon/react` 的 `<Theme>` 只发出**颜色**角色，布局间距刻度不在其中，线上实测 `--cds-spacing-01..07` 全部为空。那 58 处 `var(--cds-spacing-NN, Xpx)` 一直在走像素 fallback。现在改成自持的 `--workspace-space-*`，数值不变，但引用不再是装饰性的。
2. 同类幻影 token：`--cds-layer-00`、`--cds-selection` 也不存在（已从新代码里去掉）。`--cds-layer-02` 在 g10 实测为 `#f4f4f4`，与仓库里写的 `#e5e5e5` fallback 不符——因为 token 在 wrapper 上始终存在，fallback 从不生效，属低风险记录问题。

**评估后决定不做，并说明原因**：

- **F3（设备详情页每帧重建 `chartContext` / `sectionControls` / `DeviceChartCells`）**：F1 把 Provider 的 `value` memo 化之后，轮询驱动的整树重渲染已经消失，这是这条的主要成本来源。剩下的对象拼装要真正 memo 住，必须先 memo 住它上游约 15 个每帧新建的数组（`cpuInstances`、`aggregates` 等），否则依赖比较永远不相等、memo 永不命中。那是一次范围更大、且会给图表带来**数据陈旧风险**的重构，收益只剩每帧几次 `.map()`；`limitTileSeries` 实测是 O(n) 步进采样、n≤240，成本可忽略。所以这里刻意不做，而不是做一层不会命中的假 memo。
- **E10/E11（乐观更新不回滚、`localStorage` 未 try/catch）**：E10 只在桌面端 Agent 设置页触发（网页端 `canManageLocalAgent=false`，该分支不渲染），E11 需要确认 Safari 隐私模式下的真实抛错路径。两条都保留在清单里，未在本批动，避免在一条以视觉为主的发布线里混入难以验证的桌面写入行为。

**新增的回归防线**：`scripts/visual-regression.cjs` 多了一个 `hasTouch: true` 的第二页面，在 4 条路由上断言任何可交互元素命中区域 ≥44px，并且**会点开抽屉再扫一遍**，例外必须写进 `touchExempt` 数组。之前所有触屏热区退化对测试套件都是隐形的，因为没有任何一次运行匹配 `(pointer: coarse)`。

### 这条新断言上线过程中跑红了三次的记录（重要）

它不是一次通过的，而且每一次「通过」和「失败」都携带信息，值得留档：

| 轮次 | commit | 结果 | 原因 |
|---|---|---|---|
| 1 | `3dae0ba` | 红 | fixture 用 `page.route()` 注册在**单个 page** 上，不是 context。新开的触屏页面没有桩，`/api/auth/session` 打到真实 dev server 返回 401，控制台渲染成登录页 → `.workspace-root` 永远等不到，表现为一个像选择器写错了的 TimeoutError。 |
| 1 修正 | `ac92539` | 红 | 断言按「每个图形元素 ≥44」写，会把 CSS 逼去把 Carbon 的 20px 开关药丸撑大。改为向上找最近 label/row 取较大者，测**实际命中区域**。 |
| 2 | `fd6b2fa` | 红 | 抓到两条：顶栏图标按钮 40×44（`pages.css` 在 ≤599 写的 `min-width:40px` 是 `(0,2,0)`，压过裁决层 `(0,1,0)` 的 coarse 契约）、面包屑文本按钮 24×17。 |
| 3 | `ebb9784` | **绿，但绿得有水分** | 断言只采样「抽屉关闭」的窄屏，而侧栏控件在 390px 是 `visibility: hidden`，根本没进测量集合 → 4 条 `(0,2,0)` 的 `min-height` 全部漏网。补上「点开抽屉再扫」。 |
| 4 | `18c3030` | 红 | 抽屉那一扫立刻抓到侧栏折叠钮 40×40。根因是我上一轮只把它的 `30px` 换成 `var(--workspace-control-height)` —— **只要复合选择器还声明这个属性，它就仍然赢**，换 token 只是把 30 变成 40，性质未变。 |
| 5 | `18c3030` 之后 | 绿 | 复合选择器彻底不声明尺寸。随后全仓扫了一遍「特异性≥2 且声明 width/height 的复合选择器」，确认无其它同类。 |

**结论性的一条经验**：`@media (pointer: coarse)` 不加特异性，所以「排在文件末尾」在这个项目里从来不是理由；而「把硬编码值换成 token」也不等于修复——只要那条 `(0,2,0)` 规则还在声明这个属性，裁决层的 `(0,1,0)` 就永远赢不了。正确动作是**让复合选择器不再声明该属性**。

---

## 证据来源

三条独立证据链交叉验证，避免把已修的问题算进来：

1. **HEAD 源码静态审读**：全部 65 个 `console-ui` 文件 + `apps/web` 非归档文件，逐条定位到 `文件:行号`。
2. **线上中枢实测**（`http://192.168.5.17:3100`，镜像 `3.0.106`）：用缓存 chromium 走 CDP，在 5 组宽度 × 4 条路由 × 明暗两套主题下量几何、计算样式、可及名、对比度，并模拟 `pointer: coarse`。
3. **HEAD 的 CI 视觉回归产物**（run `36228973711`，artifact `web-visual-regression-b8bcf41…`，40 格截图 + 报告）：这是当前代码的真实渲染，用来判定「线上看到的到底是旧版问题还是 HEAD 问题」。

**已排除的误报**（静态审读提出、经 HEAD 源码/CI 断言证伪，不计入清单）：

- 「移动端设备表格没有横向滚动容器、5 列不可达」→ HEAD 已在 `workspace-carbon.scss:1083` 加 `overflow-x:auto` + 1076px 定宽表，且 `visual-regression.cjs:875` 已断言可滚动。
- 「`.workspace-device-statusline` 是渲染出来的 M3 残留」→ 该类在 HEAD 全部 `.tsx` 中零引用，属死代码（归入 G 类）。
- 「390px 下内容被底部导航遮挡」→ 是截图视口折叠，`workspace.pages.css:86` 有 `padding-bottom: 92px`。
- 「命令面板 `activeIndex` 会越界」→ `onChange` 里已 `setActiveIndex(0)`。

---

## A. 直接可见的显示异常（P0）

| # | 现象 | 证据 | 根因 |
|---|---|---|---|
| A1 | **命令面板里套了一个 28px 大圆角的 M3 灰盒子**：外层 Carbon Modal 是直角 `#f4f4f4`、680px；内层 `.workspace-command` 实测 `border-radius: 28px`、`background: rgb(231,236,242)`、宽 620px，右侧留 60px 死空带 | 线上实测 5/5 场景一致（`p2-*.json → palette.inner`）；`workspace.m3.css:628-633` + `workspace.dashboard.css:121`；`workspace-carbon.scss:892` 只补了 `display:grid; gap:12px` | Carbon 化时只裁决了 Modal 外壳，没裁决内层容器 |
| A2 | **命令面板与吐司完全没有阴影**：`box-shadow: var(--workspace-elevation-3)` 引用的 token 从未定义（tokens 里只有 `--workspace-elevation-1`），整条声明在 computed-value 阶段失效 | `workspace.m3.css:632`、`:650`；全仓 grep `--workspace-elevation-2/3` 无定义 | token 缺失 |
| A3 | **空状态卡片是「另一个 App」**：`.workspace-empty` / `.m3-state-surface` 实测 `border-radius:12px` + 底色 `#f3f6fa`（浅）/ `#191c1e`（暗），而同一页的 Carbon 卡片是直角 + `#ffffff` / `#262626` | 线上实测 `empty` 计算样式；`workspace.dashboard.css:108-109`、`workspace.m3.css:581-596`；`pages/shared.tsx:824`、`SettingsPage.tsx:523` 引用 | M3 层未收口 |
| A4 | **图表 X 轴时间是英文 AM/PM**（`9:56:30 AM`），而页面其它日期一律 `9月26日 08:13`；标签还 45° 旋转后互相压字 | HEAD CI 截图 `matrix-round-1-light-1440-device-detail.png`、`…-dark-…` | `CarbonCharts.tsx` 从不给 `@carbon/charts` 传 locale，轴标签跟随浏览器语言；而 `formatters.tsx:116` 硬编码 `zh-CN` + `hourCycle:h23`。两套时间口径 |
| A5 | **CPU 图 Y 轴无单位**：刻度只有 10–60，不带 `%`，必须靠标题才知道是百分比 | 同上截图 | `CarbonCharts.tsx:34` `axisOptions` 未设 `maps/unit` |
| A6 | **暗色下图表可读性塌陷**：X 轴标签深灰压深灰；「物理与已提交内存」面积图与背景几乎同色；侧栏选中项对比度极低 | CI `matrix-round-2-dark-1440-device-detail.png` | 暗色只换了 Carbon 主题，图表配色/轴色未跟随（`CarbonCharts.tsx:19-22` 在 render 期读 dataset，且 donut/meter 与 time-series 走不同分支） |
| A7 | **「数据来源」格右上角一个孤立绿色小方块**，无文字无可及名 | CI `matrix-round-1-light-1440-overview.png`、`840-overview.png`；`pages/shared.tsx:402` 用 `<StatusLabel compact />`，而 `ui.tsx:139-145` 在 compact 时把文字整个去掉、点本身 `aria-hidden` | compact 态设计成纯色点，既没视觉标签也没可及名 |
| A8 | **「观澜」在顶栏重复两次**：侧栏品牌区一个，顶栏 leading 又一个 | CI 全部 1440/840 截图；`PrimaryNavigation.tsx:68` + `AppTopBar.tsx:14`，两处都只判 `!capabilities.canControlNativeWindow` | 桌面靠原生标题栏去重，网页端两个条件同时成立 |
| A9 | **总览页同一事实说三遍**：顶栏「在线」chip、摘要「在线 2/3 · 1 台未响应」、摘要「需要关注 1 · 1 台未响应」、告警条「设备状态存在异常 1 台未响应」、「连接与同步」卡里再来一个「在线」tag + 「当前状态 实时连接」 | CI `matrix-round-1-light-1440-overview.png` | `OverviewPage.tsx:51/133` + `shared.tsx:394` + `HubStatusCard` 各自独立成块，没有做信息去重 |
| A10 | **设备详情页四层导航叠在一起**：一级 Tab（概览/处理器与内存/存储与网络/显卡与散热）→ 时间范围分段控件 → 二级 Tab（硬件平均趋势/容量占用/硬件与 Agent）→ 又用一个 H2 重复二级 Tab 的当前标题「硬件平均趋势」 | CI `matrix-round-1-light-1440-device-detail.png` | `DeviceDetailsPage.tsx` + `deviceCharts.tsx` 的区块标题直接复用 tab label |
| A11 | **设备名在 40px 内出现三次**：面包屑「… / 工作站 · 上海」+ eyebrow「设备」+ H1「工作站 · 上海」+ 副行 `windows · workstation-01` | 同上截图 | 页头信息层级未设计 |
| A12 | **窄屏「时间范围」控件换行破碎**：5 分钟/1 小时/6 小时/24 小时在第一行，「7 天」孤零零掉到第二行，「全屏」挤在左侧，控件外框只包住第一行 | CI `matrix-round-1-light-390-device-detail.png` | 分段控件换行后边框按 item 绘制，容器没有跟着重排 |
| A13 | **窄屏一级 Tab 截断到只剩一个字**：「显卡与散热」显示成「显」+ 一个 `>` | 同上 | Tab 横向滚动条的可见宽度分配 |
| A14 | **顶栏搜索按钮在 390px 渲染成一个空的蓝色描边框**，只有放大镜，看起来像未加载完的输入框 | CI `matrix-round-1-light-390-{overview,devices,settings}.png`；`workspace.pages.css:80` 把它收成 40px 图标钮但保留了 `variant="outlined"` 边框 | 图标化后未同步去掉描边 |
| A15 | **设置页移动分区导航与设备页筛选 chip 是两套选中态**：设置页选中 = 浅蓝底 + 蓝描边；设备页选中 = 灰底无边框。同为「筛选/切换」语义 | CI `matrix-round-1-light-390-settings.png` vs `…-390-devices.png`；`workspace-carbon.scss:856-865` 只给 settings 侧下发 `--cds-layer-01` | 两个控件族分别裁决 |
| A16 | **告警条圆角与页面其它块不一致**：黄色 `设备状态存在异常` 条在 840/390 下明显带圆角，而 Carbon 通知应为直角 | CI `matrix-round-1-light-840-overview.png`、`…-390-overview.png`；`workspace-carbon.scss:273-286` 只改了 `border-left` 与背景，未清 `border-radius` | `.workspace-attention` 挂在 Carbon `ActionableNotification` 上，三层旧规则未删 |

## B. 设计体系不一致：Carbon 化残留（P1）

B 类的共同特征：**这些元素读的是 `--workspace-color-*`（M3 调色板）而不是 `--cds-*`**，所以它们不随 Carbon 主题走，明暗切换时和 Carbon 层分家。

| # | 位置 | 问题 |
|---|---|---|
| B1 | `workspace.telemetry.css:22-50` `.workspace-telemetry-model-chip` | `border-radius: 7px` 硬编码 + 9px/10px 字号，实测 48px 高、7px 圆角，设备详情页硬件列表在渲染（`pages/shared.tsx`） |
| B2 | `workspace.dashboard.css:108-109` `.workspace-empty` | `12px` 圆角 + `--workspace-border-strong` 虚线边 + 40px 圆角 mark（见 A3） |
| B3 | `workspace.pages.css:141,154` `.workspace-onboarding` / `.workspace-advanced` | `border-radius: 14px` —— 14px 根本不在形状刻度（4/8/12/16/28/999）里，纯手调 |
| B4 | `workspace.dashboard.css:22,58,62,78` | `.workspace-web-settings__status`、`.workspace-detected-row`、`.workspace-metric-option-group`、`.workspace-danger-note` 全是 12px 圆角 + `shadow-soft`，设置页与已 Carbon 化的 `.chart-tile`（直角、细线、无阴影）同屏并存 |
| B5 | `workspace.dashboard.css:13-16` `.workspace-traffic-calendar__cell` | 8px 圆角 + `--workspace-accent-soft` 热色底 + 内联 `opacity`（`shared.tsx:588`） |
| B6 | `workspace.details.css:3-4`、`workspace.dashboard.css:88` | 链接色用 `--workspace-accent`（`#3d638f`/`#a8c9f5`），同页 Carbon 交互色是 `--cds-interactive` `#0f62fe` —— 一个页面两种蓝 |
| B7 | `SettingsPage.tsx:80-81` | `M3Switch` 行以 `> .m3-switch-row` 直接放进 `.workspace-settings-list`（命中 `workspace.m3.css:561-567` 的 outline-variant 分隔线 + `padding-block:10`），而同列表其余行是 72px 高的 `workspace-setting-row` —— 一个列表两种行契约 |
| B8 | `workspace.m3.css:3-24` | `.m3-button` 基座（`radius: full`、M3 语义色）仍整体命中所有 `ui.tsx Button`，靠 `workspace-carbon.scss` 里 6 条 `!important` 强行压住。M3 组件层现在的作用只剩「给 Carbon 组件挂一套需要被 `!important` 围剿的类」 |
| B9 | `workspace.m3.css:415-439` `.workspace-select, .workspace-input` | 通过 `selectClassName` 落到 Carbon `<Select>` 的**外层 div** 上，给它套了 1px outline 边框 + 8px 圆角 + container-low 底色，与内层 `.cds--select-input` 的 field 底色叠加成「双边框双底色」。`.workspace-input` 已零引用 |
| B10 | 全局 | 两套主题机制并行：`html[data-dsc-resolved-theme]`（`WorkspaceContext.tsx:215-235` 自己 `matchMedia`）驱动 `--workspace-*`；Carbon `<Theme>`（`WorkspaceFrame.tsx:14-20` 又独立 `matchMedia` 一次）驱动 `--cds-*`。两处 resolve 逻辑重复，任一侧改动都会让明暗主题分裂 |
| B11 | `window-material.css:77-132` | 材质切换给 `--workspace-surface-acrylic/-subtle/-hover` 提供手调蓝灰色板（`#1c2229`/`#25313b`），与 Carbon g100 中性灰不同色相。用户在设置里切材质时，只有 M3 残留层会变蓝灰，Carbon 层不动 → 「半个 App 变色」 |

## C. 触屏与响应式契约失效（P1）

`workspace-carbon.scss:1199` 的注释写着「Touch targets last, so they out-rank every desktop control height above」——**这句话不成立**。`@media (pointer: coarse)` 在第 1 层，加媒体查询不增加特异性，压不过同层里 `(0,2,0)` 的复合选择器。线上模拟 coarse 实测：

| # | 控件 | 实测尺寸 | 应为 | 被谁压掉 |
|---|---|---|---|---|
| C1 | 侧栏折叠钮 / 顶栏抽屉钮 `.workspace-icon-button.m3-icon-button` | **30×30** | ≥44 | `workspace.m3.css:338` `(0,2,0)` |
| C2 | 侧栏导航项 `.workspace-nav-item.m3-navigation-item` | **40** | ≥44 | `workspace.m3.css:211` `(0,2,0)` |
| C3 | 表格行操作钮 `.guanlan-table-row-action` | **32×32** | ≥44 | carbon coarse 名单未覆盖 |
| C4 | 筛选 chip `.m3-chip.cds--btn--sm` | **32** | ≥44 | 同上 |
| C5 | 搜索输入 `.cds--text-input--md` | **40** | ≥44 | 同上 |
| C6 | 分段控件 `.cds--content-switcher-btn` | **40** | ≥44 | 同上 |
| C7 | 图表卡头按钮 `.chart-tile__controls .cds--btn` | **32** | ≥44 | `dashboard.css:163` 在第 4 层（最顶层），是唯一「顶压底」的反向回归，必须在 `dashboard.css` 里补 coarse 分支 |
| C8 | 设置页移动 chip / M3 开关 compact 行 / 探针复选框 | 38 / 32 / 28 | ≥44 | `workspace.settings.css:8`、`workspace.m3.css:476-486` |

其余响应式问题：

| # | 问题 | 证据 |
|---|---|---|
| C9 | **断点共 14 个、互不重叠**：599/620/671/672/768/839/900/960/1056/1080/1199 + `portrait`。同一组件在不同文件用不同断点 | `grep @media` 全量清单见附录 |
| C10 | **竖屏平板（portrait 且宽 >839）底部导航永远不出现**：`workspace.m3.css:689` 的 `(≤839) or (portrait)` 分支重排了一个已被 `workspace.pages.css:51` `display:none` 关掉的元素（pages 在 L1 内排在 m3 之后） | 层序推导 + `workspace.pages.css:94` |
| C11 | **769–839px 横屏打开侧栏抽屉时没有遮罩**：抽屉 `display:block` 在 `pages.css:65`(≤839) 生效，但 backdrop 的 `display:block` 在 `responsive.css:41`(≤768 or portrait) —— 区间内点不到遮罩关闭 | `workspace.responsive.css:41` vs `workspace.pages.css:65` |
| C12 | **顶栏窄屏换行设计从未生效**：`responsive.css:82-88` 的 `min-height:52px; flex-wrap:wrap` 被 `workspace-carbon.scss:55-62`（L3）的 `height:56px; flex-wrap:nowrap` 静默压掉 | 线上实测顶栏恒 56px 单行 |
| C13 | **`.workspace-content` 的 padding 三条规则全灭**：`shell.css:491` 与 `dashboard.css:154` 都被 `carbon.scss:124-127` 的 `padding:0` 裁决；而 `responsive.css:74` 靠 `!important` 才保住 `padding-bottom:74px`，与 `pages.css:86` 的 `92px` 在移动页叠加成 ~166px 底部空白 | 层序 + `!important` 优先级 |
| C14 | 吸顶条高度三处手调：`carbon.scss:1130`（sticky 条）、`responsive.css:138`（`scroll-padding-top:76px`）、`DeviceDetailsPage.tsx:105`（`rootMargin:"-72px"`），改一次高度要同步三处 | — |

## D. 可访问性（P1/P2）

| # | 问题 | 证据 |
|---|---|---|
| D1 | **图标按钮可及名只靠 `title`**：顶栏「设置」按钮实测 `aria-label` 为空、只有 `title="设置"`（`AppTopBar.tsx:20`）。「刷新」按钮更糟 —— `!refreshing && <span>刷新</span>`，**正在刷新时可见文本消失，名字退化成 title**（`AppTopBar.tsx:19`）。线上 30 组采样里累计 60 次命中「无文本无可及名」的 `m3-icon-button` | 线上实测 `namelessControls` + `badText` |
| D2 | **命令面板键盘导航对读屏完全静默**：14 个 `role="option"` 已生成 `id`，但 Search 输入框没有 `aria-activedescendant`，焦点始终留在输入框。线上实测 `activedesc: null` | `CommandPalette.tsx:132-141` + 线上实测 |
| D3 | **所有时间序列图共用同一个 `svgAriaLabel="硬件指标时间趋势图"`**：设备详情页十几个图（CPU/内存/温度/频率…）在读屏下同名无法区分 | `CarbonCharts.tsx:65` |
| D4 | **焦点环双轨**：`workspace.tokens.css:170-173` 给 `button/input/select` 统一 `outline: 2px solid var(--workspace-accent)`，而 Carbon 自己用 `--cds-focus` 的 inset 焦点。两套并存时 Carbon 组件会出现「外圈 M3 蓝 + 内圈 Carbon 蓝」 | `workspace.tokens.css:170` |
| D5 | **compact `StatusLabel` 无任何可及名**（`ui.tsx:139-145`，点本身 `aria-hidden`、compact 时文字被删），且是全站唯一「纯颜色承载状态」的位置 —— 见 A7 |
| D6 | **小屏侧栏抽屉无 Esc、无焦点陷阱**：遮罩是 `<div onPointerDown aria-hidden>`（`WorkspaceFrame.tsx:42`），抽屉打开时 Tab 仍能走到遮罩后面的内容 |
| D7 | 设置页移动分区导航的选中项**没有 `aria-current`**（`SettingsPage.tsx:58`），读屏不知道当前在哪个分区 |
| D8 | 表格行 `<tr>` 绑 `onClick/onKeyDown` + `tabIndex=0` + `aria-label`（`shared.tsx:331-346`），但 `aria-label` 落在非 widget role 上，多数读屏不播报 |
| D9 | 切换设备/切换时间窗后数据整体替换，**没有 `aria-live` 播报**，视障用户不知道内容已变 |
| D10 | 暗色下 `button.guanlan-table-link` 实测对比度 **3.45:1**（`#4589ff` on `#391c1e/rgb(57,57,57)`），低于正文 4.5:1 要求 | 线上 dark 采样 |
| D11 | 全仓无 `::selection` 定义；`tokens.css:155` 的 `scrollbar-color` 用 M3 灰，Chromium < 121 无 `::-webkit-scrollbar` 后备，暗色下会露出系统白滚动条 |

## E. 逻辑与状态缺陷（P2）

| # | 问题 | 证据 |
|---|---|---|
| E1 | **网页端无数据时的兜底文案是「桌面桥接尚未准备好。请重新打开观澜后再试。」** —— 浏览器里根本没有桌面桥接，也不该重开观澜 | `OverviewPage.tsx:35` 的 fallback 未按 `capabilities` 分流 |
| E2 | **切换时间窗口瞬间弹假空态**：`metrics` 要求 `snapshot.metrics.window === metricsWindow`，切窗后新数据未到时 `metrics=null`，于是弹出「还没有收到遥测样本 / 确认 Agent 正在运行」+「暂无可用遥测」 | `DeviceDetailsPage.tsx:145,280,377` |
| E3 | **零设备时两条互相矛盾的空态同时出现**：「没有匹配设备 · 尝试清空搜索或调整状态筛选」+「还没有设备接入」 | `DevicesPage.tsx:114` 与 `:118` |
| E4 | **轮询失败 8 秒后彻底静默**：`error && snapshot` 时页面不显示任何持久提示（`ErrorSurface` 只在 `!snapshot` 时出现），用户继续看旧数据且不知道它旧了 | `WorkspaceContext.tsx:140-143` + `WorkspacePages.tsx:16` |
| E5 | **表格百分号不四舍五入**：线上真实数据 `cpuUsagePercent: 66.69`，`${device.cpuUsagePercent}%` 直接拼 → 显示 `66.69%`；图表侧一律 `Math.round`，同一指标两种精度 | `shared.tsx:246,297` vs `deviceCharts.tsx:139` |
| E6 | **一块坏盘让整机磁盘显示「容量暂无」**：`reduce((t,d)=>t+d.usedBytes,0)` 任一 `undefined` → 总和 `NaN` → `formatCapacitySummary` 兜成「容量暂无」。`deviceCharts.tsx:329` 同类求和用了 `?? 0`，两处不一致 | `DeviceDetailsPage.tsx:169` |
| E7 | **web 端 `generatedAt` 每次刷新都重置成当前时间**，即使拿的是刚失败前的旧数据也显示「同步于 <现在>」，掩盖数据新鲜度 | `apps/web/src/lib/console-adapter.ts:120` |
| E8 | **术语「离线」/「未响应」混用指同一状态**：表格 Tag、筛选 chip、详情页用「离线」（`shared.tsx:164,251`、`ui.tsx:140`、`DeviceDetailsPage.tsx:318`），总览需要关注卡与摘要用「未响应」（`OverviewPage.tsx:51,133`、`shared.tsx:394`）。用户会以为是第三种状态 |
| E9 | **单位空格写法不统一**：`${x} °C`（`deviceCharts.tsx:141`、`shared.tsx:665`）与 `${x}°C`（`shared.tsx:670`）同页并存 |
| E10 | **乐观更新失败不回滚**：`toggleMetric` / `toggleDetectedInstance` / `updateProbe` / `updateInstanceMetricConfig` 都是「先改本地草稿 + `void updateLocalConfig(...)` 丢弃返回值」，`.catch(()=>undefined)` 吞掉异常，复选框停在错误勾选态直到重进页面（仅桌面端渲染，网页端不触发） | `SettingsPage.tsx:381,395,413,423` |
| E11 | **`localStorage.setItem` 未 try/catch**：`setSidebarCollapsed/setTheme/setDensity/setRefreshInterval` 在隐私模式/存储写满时抛异常并冒泡到 onClick | `useWorkspaceUiState.ts:121-133` |
| E12 | **api 路径未 `encodeURIComponent` deviceId**：`deleteDevice` 有编码，其余 6 处没有，含特殊字符的 ID 会 404 | `apps/web/src/lib/api.ts:113,129,154,167,171,177` |

## F. 性能与 CSS 架构债（P2/P3）

| # | 问题 | 证据 |
|---|---|---|
| F1 | **Context `value` 未 `useMemo`**：Provider 下任意状态变化（含每 5–30 秒一次轮询）都让所有 `useWorkspace()` 消费者整体重渲染 —— 导航、表格、全部图表磁贴 | `WorkspaceContext.tsx:355-418` |
| F2 | **改时间窗 / 翻流量日历 / 切设备都会关掉再重开 socket.io**：订阅 effect 依赖 `fetchSnapshot`，而后者依赖这四个状态；每次还附带一次全量拉取 | `WorkspaceContext.tsx:166-173` |
| F3 | 设备详情页 `chartContext`、`sectionControls`、`DeviceChartCells` 的 `flatMap` + 逐序列降采样每帧重算，无 memo；`DeviceDetailsPage.tsx:181` 的 `fallback` 时间戳每帧 `new Date()` → 风扇图当前点抖动 | `deviceCharts.tsx:836,886` |
| F4 | 命令面板 `commands`（含全量 `allDevices.map`）与 `filtered.sort` 未 memo，每敲一个字符全量过滤+排序 | `CommandPalette.tsx:79-90` |
| F5 | **`!important` 共 59 处**（`workspace-carbon.scss` 36、`workspace.m3.css` 8、`shell.css` 6、`dashboard.css` 4、`pages.css` 3、`responsive.css` 2）—— 是 CSS 分层互相打架的量化证据 |
| F6 | **绕开 token 的硬编码**：圆角字面量 20 处（含刻度外的 14px）、字号 9px/10px 共 13 处、`z-index` 15 处无刻度、滚动遮罩两种写法（`rgba(0,0,0,.45)` / `rgb(20 28 36/38%)`）而 `--workspace-scrim` 已存在未用 |
| F7 | **缺两套 token**：没有 `--workspace-space-*` 间距刻度（约 530 个 px 值无处挂靠）、没有 `--workspace-z-index-*`。建议按 `dashboard.css`(L4) 的做法直接改用 `--cds-spacing-*` |
| F8 | **`workspace-carbon.scss` 的 125 个 hex fallback 有系统性错值**：`--cds-background` 的 fallback 写成 `#f4f4f4`（那是 g10 的 `layer-01`，g10 background 是 `#ffffff`）；`--cds-layer-02` fallback 写 `#ffffff`。规则一旦落出 `.guanlan-carbon-theme` 作用域就拿到错误灰底 —— 正是该文件头注释警告的 "silently drifts" |

## G. 死代码（P3）

CSS 里定义了但**全部 `.tsx` 零引用**（判据：类名在所有 `className` 中出现 0 次）：

`.workspace-device-statusline`（`workspace.m3.css:740-752,835-841`）、`.workspace-input`、`.m3-tab`（9 处）、`.m3-segmented-control__option`、`.m3-field__input`、`.m3-switch__thumb`、`.workspace-overview-grid` / `.workspace-device-grid`（7 处）、`.workspace-topbar h1` / `.workspace-topbar__eyebrow`、`.workspace-btn` / `.workspace-tab` / `.workspace-layout-actions__button`、`.workspace-panel-bar`、`.workspace-layout-toolbar`、`.workspace-dynamic-empty__inline`、`.workspace-hub-heading__name` / `__count`、`.workspace-instance-tabs`、`.workspace-hub-facts`、`.telemetry-info-card__rows`、`.workspace-windowbar__mark`（非 `-img`）、`.workspace-brand__mark`（实际只渲染 `*-mark-img`）、`@keyframes workspace-spin`。

**反向孤儿（JSX 用了、CSS 无人定义）**：`workspace-collection-surface`（`SettingsPage.tsx:466`）、`chart-tile__body--details`（`ChartTile.tsx:76`）、`m3-snackbar--{tone}`（`AppTopBar.tsx:37` —— **错误/信息吐司视觉完全相同**）。

**JS 侧死代码**：`helpers/metricsNormalizer.ts`（含第二份 `formatBytes`，与 `formatters.tsx:12` 实现不同，全仓仅 `layout.test.ts` 引用）；`formatters.tsx:25` 的 `MetricValue` / `CapacityMetricValue`（未渲染，且 `NaN == null` 为 false，会把 `NaN%` 原样输出）。

---

## 修复计划

### 批次 1 —— 裁决层收口，消掉所有「一眼看过去不像同一个 App」的问题（A1–A8、A16、B1–B9、G 的死 CSS）

做法：把 `workspace-carbon.scss` 作为 shell/overlay 组件的唯一裁决层补齐，同时**删掉第 1 层里被裁决的旧声明**（不是再叠一层覆盖 —— 那是本项目反复踩坑的根源）。

1. `workspace-carbon.scss` 给 `.guanlan-command-modal .workspace-command` 补 `border:0; background:transparent; border-radius:0; backdrop-filter:none; box-shadow:none; width:auto`，并删除 `workspace.m3.css:628-633`、`workspace.dashboard.css:121` 中与模态冲突的属性。
2. 把 `.workspace-empty`/`.m3-state-surface`、`.workspace-telemetry-model-chip`、`.workspace-onboarding`、`.workspace-advanced`、设置页四个 M3 卡片、流量日历 cell 统一收进 Carbon：直角或 `--cds-border-subtle-00` 细边 + `--cds-layer-01` 底色 + 无阴影。
3. 删掉 G 类全部零引用 CSS 与 JS 死代码；给三个反向孤儿补样式（尤其 `m3-snackbar--error/info` 必须能区分）。
4. 修 A7/A8：`shared.tsx:402` 的 compact `StatusLabel` 改为带文字或加 `aria-label`；`AppTopBar.tsx:14` 的顶栏品牌在网页端去掉（侧栏已有）。
5. 修 A2：定义 `--workspace-elevation-2/3` 或直接删掉两处引用（按 Carbon 方向选后者）。

**验收**：CI `visual-regression.cjs` 的 40 格截图人工复核 + 新增几何断言（模态内层 `border-radius === 0`、内层宽度 === 外层宽度）。

### 批次 2 —— 图表与时间口径（A4、A5、A6、D3）

给 `CarbonCharts.tsx` 统一注入 `locale`/`hourCycle`，让轴标签走 `formatters.tsx:116` 同一套 `zh-CN` 24 小时口径；Y 轴带单位；暗色主题从 context 的 `resolvedTheme` 取而不是 render 期读 DOM；`svgAriaLabel` 透传 `chart.title`。

**验收**：CI 截图在 `locale:"en-US"` 的 runner 上仍输出中文 24 小时轴 —— 这条断言能永久钉死「图表跟随浏览器语言」的回归。

### 批次 3 —— 触屏热区与断点（C1–C14）

1. 先删 `workspace.m3.css` 里所有尺寸声明（`:211`、`:330-336`、`:338`、`:476-486`），让几何唯一归口 `workspace-carbon.scss`；`.chart-tile__controls .cds--btn` 的 32px 在 `dashboard.css`(L4) 里补 `@media (pointer:coarse)` 分支。
2. coarse 块逐条改用与 L1 相同的复合选择器写法，并把 `carbon.scss:1199` 那句错误注释改成可验证的契约说明。
3. 断点收敛成一套（建议 Carbon 2x Grid 的 320/672/1056 + 一个 839 紧凑档），抽屉/bottom-nav/backdrop 三处共用同一组变量；修 C10 竖屏平板、C11 遮罩区间、C13 双重底部留白。

**验收**：新增 CDP 断言 —— 模拟 `pointer:coarse` 时，所有可交互控件 `min(w,h) >= 44`，白名单显式列出例外。这条我打算直接加进 `visual-regression.cjs`，否则下次还会退化。

### 批次 4 —— 可访问性（D1–D11）

图标按钮补常驻 `aria-label`（刷新按钮尤其）；命令面板补 `aria-activedescendant`；焦点环统一交给 Carbon（删 `tokens.css:170-173` 的自绘 outline）；抽屉补 Esc + 焦点陷阱 + `inert`；设置移动导航补 `aria-current`；数据替换补 `aria-live`；修 D10 暗色链接对比度。

### 批次 5 —— 状态与文案（E1–E12）

按 `capabilities` 分流兜底文案；E2/E3 的假空态与矛盾空态改成「加载中 vs 真的没有」；E4 加常驻 `InlineNotification`；E5/E6 统一走 `formatters` 的 `percent()` 与 `?? 0`；E7 保留真实 `generatedAt`；E8/E9 术语与单位定版并全量替换。

**注意**：改任何文案必须同步 `scripts/visual-regression.cjs` 与 `scripts/electron-visual-regression.cjs` 的断言（侧栏/底部导航标签、7 个表头、4 个选项卡、总览恰好 4 格、空态文案都被钉住），否则 CI 必红。

### 批次 6 —— 性能与 token（F1–F8）

`Context value` 加 `useMemo`、订阅 effect 依赖降到 `[adapter]`、图表与命令面板列表加 memo；补 `--cds-spacing-*` 迁移与 `z-index` 刻度；把 `workspace-carbon.scss` 的 125 个 hex fallback 校正或删除；把 59 处 `!important` 随分层收口逐步清掉。

---

## 需要你定的两件事

1. **范围**：只做 P0/P1（批次 1–4，都是「看得见」和「点不准」的问题），还是连 P2/P3 一起做（批次 5–6 改动面大、涉及 Context 重构与全量文案替换）。
2. **发布节奏**：按 AGENTS.md，每批完成要走「patch 版本 → 推 main → 打 tag → 等 Actions verify/build/publish → 核对 Release 与 Windows setup 资产 → 校验 sha256」。批次 1–4 合成一次测试版发布，还是每批各发一次？

另外提示：线上中枢目前是 `3.0.106`，HEAD 是 `3.0.108`，`3.0.107/108` 的修复还没部署。如果你希望我修完之后在线上验证，需要走一次 `deploy-test.yml`（这属于线上变更，要你明确同意我才执行）。
