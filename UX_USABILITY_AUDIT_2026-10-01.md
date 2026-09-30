# 观澜控制台 UX / 可用性审计（2026-10-01）

**审计目标**：降低上手成本、理解成本与学习成本，减少用户需要思考、记忆或反复操作的环节。
**审计范围**：网页端（`apps/web` + `packages/console-ui`）与桌面端（`apps/desktop`，共用同一套 workspace UI）。覆盖首次使用、信息架构、导航、功能可发现性、操作路径、交互逻辑、反馈、错误提示、术语命名、默认值、设置复杂度、高频任务效率。
**基线**：`main` = `159ee32e`，`VERSION` = 3.0.141。
**方法**：全量源码审读（`console-ui` 全部 workspace 页面/外壳/选择器 + web 登录与适配器）＋ 用真实组件树在无头 Chromium 中还原渲染（区别于只读源码，用于确认「两个列表同时渲染」这类只在运行期成立的事实）＋ 与既有审计（`UX_AUDIT_REPORT.md`、`FRONTEND_AUDIT_2026-09-26.md`）交叉核对，避免把已修项当成新问题。

> 本报告不复述既有审计里已经落地的条目。下面的每一项都在当前 HEAD 上重新取证（文件:行号，必要时附运行期观察）。历史审计快照仍按 `AGENTS.md` 只作背景。

---

## 执行摘要

这一版的主要问题不是「没做引导」，而是近期的设计体系迁移（Carbon → Material 3 Expressive）**丢掉了若干已经修好的信息去重与状态一致规则**，同时新增了一条**同一份设备列表渲染两遍**的重复。它们共同制造了三类认知负担：

1. **同一事实看两遍**：设备页把同一批设备同时画成卡片网格和数据表；设备详情页把「没有遥测」说三遍；总览页把「离线」说了四五遍。
2. **状态自相矛盾**：空设备但已连接的中枢，顶栏说「未连接」，摘要说「连接异常」（还配一个 ✓），正文却说「等待设备接入」；总览摘要「需要关注」在空集上显示一个勾号配「连接异常」。
3. **操作性摩擦**：总览的趋势图依赖时间范围，但该页没有范围控件（会静默沿用别的页面留下的值）；设备详情的「请使用顶部刷新按钮」是把操作外包给用户，且手机上顶栏按钮没有文字标签。

本次修复 8 个具体问题（P0×1、P1×5、P2×2），并新增 4 条回归断言。未做任何需要改动后端契约或数据模型的事。

---

## P0：同一份设备列表渲染两遍

**位置**：`packages/console-ui/src/workspace/pages/DevicesPage.tsx`（修复前 128–135 行）

**证据**：
`DevicesPage` 在同一个 `Surface` 里、面向**同一个** `visibleDevices` 数组连续渲染了两个完整列表：

```tsx
{visibleDevices.length > 0 && (
  <div className="guanlan-fleet-cards-wrap" ...>
    <DeviceCardGrid devices={visibleDevices} />   // 卡片网格
  </div>
)}
...
<DeviceTable devices={visibleDevices} ... />       // 数据表
```

`guanlan-fleet-cards-wrap` 这个类在全仓库**没有任何 CSS 规则**（`grep -rn fleet-cards-wrap --include=*.css --include=*.scss packages/ apps/` 只命中 TSX 自身），也就是说**没有任何断点会隐藏其中一份**。在真实渲染中量得：1440 / 1024 / 390px 三种宽度下，`.guanlan-fleet-card` 可计数且可见（2 台设备 → 2 张卡），同时 `.workspace-directory-surface .m3e-table` 也渲染 2 行。屏幕上每台机器出现两次，且第二份还带一段对桌面无意义的「左右滑动查看更多字段」提示。

**来历**：`DeviceCardGrid` 是 `e2dc6d7e`（Carbon 重构）为移动端加的，当时的意图是靠 `workspace-view-mode-toggle` 做「卡片 / 表格」视图切换；但该切换组件从未挂到 `DevicesPage` 上（`workspace-view-mode-toggle` 现在只剩一条死 CSS，TSX 零引用），于是一路以「两份同时渲染」的状态进入 M3E 重构并被保留。

**影响**：目录页是核心高频页。用户第一眼看到的是一半的屏幕被重复内容占满；「到底哪一份能点、哪一份能管顺序」需要重新试错；移动端更浪费首屏。

**修复**：目录页只保留数据表——它覆盖全部 7 列、桌面直读、窄屏通过既有 `overflow-x` 容器横向滚动（这条路径已有 `visual-regression.cjs` 的 1076px 不压缩断言守着）。卡片网格仍服务于总览页的「需要关注」小列表（那里数量少、且确实需要比表格更醒目的卡片）。同时把仅对触屏有意义的滑动提示恢复为**默认隐藏、窄屏才显示**——这正是它在 Carbon 版里的原始定义（被删文件 `workspace-carbon.scss` 内即 `.workspace-directory-scroll-hint { display: none; }`，M3E 层漏掉了这条）。

**回归防线**：`visual-regression.cjs` 新增 `.workspace-page--devices .guanlan-fleet-card` 必须为 0 的断言。

---

## P1：状态自相矛盾（空集但已连接）

**位置**：`shell/AppTopBar.tsx`、`pages/shared.tsx`（`OverviewSummary`）、`pages/OverviewPage.tsx`、`selectors.ts`

**证据**：`selectSnapshotSource` 对「已认证的 live 中枢 + 0 台设备」返回 `"empty"`。而下游把它当成「连接故障」：

- `AppTopBar`：`source === "live" ? "online" : ... : "unknown"` → `empty` 落到 `unknown` → 顶栏 chip 显示 **「未连接」**。
- `OverviewSummary`：`pending` 为 `null` 时显示 `—` 并配「连接异常」；而图标是 `attentionCount ? warning : check`，`null` 会走 `check` → **一个勾号紧挨着「连接异常」**。
- `OverviewPage`：同一时刻正文写「等待设备接入 / 还没有收到任何设备的实时状态」。

于是首次使用者（刚输入密钥、中枢正常、还没设备上报）会看到：顶栏未连接 + 摘要连接异常 + 正文等待接入，三条互相打架。**这恰好是最需要信心的一刻。**

**根因**：`selectHealthSummary` 只在 `source === "live"` 时给出 `pending` 数字，把「已认证的空中枢」和「未认证 / 缓存」都归成了 `null`（无法判断）。但前者的答案是确定的 **0**。

**修复**：
- `selectors.ts` 抽出 `selectAttentionCount`：`live` 与 `empty` 都给出确定数字，只有 `cache` / `unknown` 才是 `null`（确实无法判断）。
- `selectors.ts` 同时收紧 `selectSnapshotSource`：**`empty` 只表示「已认证的中枢确实没有设备」**。适配器在会话失效时会写入 `emptyConsoleSnapshot()`（`source:"empty"` + 未认证，见 `apps/web/src/lib/console-adapter.ts` 的 `markSessionExpired`），这属于连接故障，归入 `unknown`。两者此前被合并，正是「首次使用被报成故障」的根因；若不拆开，上面的「空集=0」还会把**已死的会话**报成一切正常。
- `OverviewSummary`：`null` 时用警告图标（不再用勾）；`total === 0` 时在线状态用 `unknown`，提示文案由「所有设备正常上报」改为「还没有设备接入」。
- `OverviewPage`：`empty` 时关注项文案为「还没有设备接入」，不再冒充连接故障。
- `AppTopBar`：`empty` 与 `live` 同为「在线」——顶栏芯片表达的是**数据链路**，不是机群健康；链路消失统一读作「未连接」，不再借用设备状态词「离线」。

**回归防线**：`selectors.test.ts` 新增「已认证空中枢 pending === 0、未认证为 null」；`visual-regression.cjs` 在 empty 态断言关注项为 `0`、不含「连接状态异常」、顶栏不是「未连接」。

---

## P1：总览趋势图的时间范围无法在该页控制

**位置**：`packages/console-ui/src/workspace/pages/OverviewPage.tsx`

**证据**：总览「资源趋势」卡片副标题写「每台设备一条数据线 · 最近 5 分钟」，其数据来自 `metricsWindow`；但全页只有指标切换（CPU/内存/磁盘/网络），没有范围控件。`metricsWindow` 是全局单例（`useWorkspaceUiState`），只有**设备详情页**能改。

**影响**：用户在设备页把范围调成「7 天」再回总览，总览会安静地用 7 天画图、副标题也写 7 天，但页面上没有任何地方让他知道或改回去；反之亦然。这是典型的「状态藏在别的页面里」——用户需要记忆「范围是在设备页设的」。

**修复**：在资源趋势分区的控件区加入与设备详情页同一套 `MetricWindowControl`，与指标切换并排。已验证 1440/1024/840/820/390px 均不溢出、选中段文字可见。

**回归防线**：既有 `visual-regression.cjs` 的「分段控件不得是滚动容器 / 不得溢出父级 / 选中段文字必须可见」矩阵会自动覆盖新控件。

---

## P1：Web 端「观澜」品牌重复（A8 回归）

**位置**：`packages/console-ui/src/workspace/workspace.m3e.css`

**证据**：`AppTopBar` 与 `PrimaryNavigation` 都按 `!canControlNativeWindow` 渲染品牌，Web 端两者同时成立。`FRONTEND_AUDIT_2026-09-26.md` 的 A8 曾用 `workspace-carbon.scss` 里的一条 `@media (min-width: 840px) { .workspace-root.is-web .workspace-topbar__brand { display: none } }` 修掉；该文件在 `d8d75cd8`（M3E 重构）整体删除时，这条规则**没有被搬到新层**，重复随之回归。

**影响**：宽屏 Web 端在 200px 内读到两遍「观澜」，是「像不像同一个 App」的典型信号。

**修复**：在 M3E 裁决层（`workspace.m3e.css`）原样恢复该规则，并保留原注释说明「窄屏抽屉模式下顶栏是唯一品牌」。

**回归防线**：`visual-regression.cjs` 断言宽屏 Web 顶栏品牌不可见、侧栏品牌可见。

---

## P1：设备详情页把「没有遥测」说三遍

**位置**：`packages/console-ui/src/workspace/pages/DeviceDetailsPage.tsx`

**证据**：`telemetryState === "none"`（从未上报）时同时渲染：
1. 状态横幅：标题「还没有收到遥测样本」＋ 说明。
2. 图表区 `EmptyState`：标题「暂无可用遥测」＋「硬件与系统信息仍可查看；收到第一批样本后…可使用顶部刷新按钮重新读取」。

外加页头/事实卡。同一屏两段标题几乎同义。

**修复**：图表区仅在 `pending`（样本在途中，说明「正在等什么」）时保留占位；`none` / `range` 的原因已由横幅承担，不再重复渲染第二个空态。同时 `none` 分支的「暂无可用遥测」整块删除。

---

## P1：「请使用顶部刷新按钮」把操作外包给用户，且手机上按钮无标签

**位置**：`packages/console-ui/src/workspace/pages/DeviceDetailsPage.tsx`（横幅动作）

**证据**：离线缓存 / 范围内无样本 / 从未上报三种横幅的动作是**纯文本** `<span class="workspace-caption">请使用顶部刷新按钮重新获取</span>`。而顶栏刷新按钮在 `≤839px` 被 `.workspace-topbar__actions > .workspace-button .m3e-button__label { display: none }` 隐藏文字（`workspace.pages.css:138`），手机用户找不到「顶部刷新按钮」这个文字所指。

**影响**：这是「反馈说了问题、却没给可点的下一步」的典型摩擦；在触屏上直接不可执行。既有的离线缓存横幅已用真按钮，这三处是遗漏。

**修复**：三处横幅改用真按钮（「重新读取 / 重新获取」，带刷新图标），任意宽度都可点；文案相应改成指代按钮名。

---

## P2：状态词「同步」与「刷新」混用

**位置**：`pages/OverviewPage.tsx`（中枢卡）、`pages/SettingsPage.tsx`（通用·同步情况）

**证据**：同一个 `refresh()` 动作，顶栏叫「刷新 / 刷新状态 / 立即刷新」，而这两处叫「立即同步 / 正在同步」。同一产品内两个词指向同一个按钮，用户需要自行建立映射。

**修复**：统一为「刷新 / 正在刷新 / 立即刷新」。保留「同步」仅用于真正描述数据时间戳的字段（如「最近同步」「同步于 …」），那里它表达的是事实而非动作。

---

## P2：发布通道直接打印英文枚举

**位置**：`pages/DeviceDetailsPage.tsx`、`pages/deviceCharts.tsx`、`pages/SettingsPage.tsx`（关于页）

**证据**：`agentChannel` / `currentChannel` 的线上取值是 `"stable" | "test"`，三处直接渲染原值。用户会在全中文界面里读到「发布通道：test」。关于页还把 `channel` 直接拼成「（test 通道）」。

**修复**：新增 `formatReleaseChannel`，`stable → 稳定版`、`test → 测试版`、其余回退原值或「未知」；三处统一走它。关于页版本串改为「观澜 x.y.z（测试版）」。

---

## 未做（并说明理由）

- **总览摘要两块并存**：`OverviewSummary` 里 `guanlan-fleet-hero` 之后还跟着一个 `aria-hidden="true"` 的 `workspace-overview-summary`「视觉回归/无头兼容层」，CSS 里 `display: none`，对用户不可见但确是重复 DOM。它被视觉回归测试（`.workspace-overview-summary__item`）直接依赖，属**测试替代渲染**的技术债，删除需要同步改写回归断言，超出本次「降低用户负担」的范围，未动。
- **可自定义快捷键**：`shortcuts` 仍是只读参考。自定义需要绑定层与冲突检测，是独立特性，不属本轮简化。
- **桌面 Agent 高级设置**：采样间隔、探针来源、逐实例覆盖仍全部位于「高级设置」折叠区内，且折叠区内所有控件改即存。信息密度已经不低，但把「逐实例指标覆盖」再抽象会牺牲高级用户的效率，判断为**不该简化**。
- **`v3.0.141` 版本与发布**：本轮不改版本号、不打 tag、不发 Release（遵循 `AGENTS.md`：默认不发版）。

---

## 验证

本机（不产出交付物）真实执行：

| 命令 | 结果 |
| --- | --- |
| `pnpm -r typecheck` | 全部 5 个 workspace 通过 |
| `pnpm --filter @dsc/console-ui lint`（= tsc） | 通过 |
| `pnpm verify:version` | `Version consistency check passed: 3.0.141` |
| `pnpm check:desktop-ui-boundaries` | SUCCESS |
| `pnpm check:web-ui-boundary` | SUCCESS |
| `pnpm check:adapter-contracts` | SUCCESS |
| `pnpm check:desktop-agent-state` | SUCCESS（29 字段） |
| 契约测试（routes/selectors/dashboard/diagnostics/chartIdentity/configKeys/captionGlyphs/ui-helpers/adapter-contracts/renderer-security/window-material） | 11 个套件、62 项全部通过 |
| 真实组件树渲染核对（1440/1024/840/820/390px） | 目录页卡片重复已消失；总览新控件不溢出；空集状态自洽 |

**本机无法执行**：`pnpm build`、`test:electron-visual`、`test:electron-visual` 所依赖的 Electron 打包，以及 `scripts/visual-regression.cjs` 的完整 Playwright 矩阵（CI 专用）。这些按仓库约定由 GitHub Actions 执行。`.ts` 契约测试在本机 Node 22.22.1（编译时未启用 TS 支持）下无法直接 `node --test`，改用仓库内 esbuild 打包后运行，语义与 CI 一致。

---

## 变更清单

| 文件 | 变更 |
| --- | --- |
| `pages/DevicesPage.tsx` | 移除与数据表重复的卡片网格 |
| `workspace.m3e.css` | 恢复 Web 顶栏品牌去重规则；恢复滑动提示默认隐藏 |
| `pages/OverviewPage.tsx` | 资源趋势加时间范围控件；空集关注文案；「同步」→「刷新」 |
| `pages/shared.tsx` | 摘要：空集在线状态与关注图标/文案自洽 |
| `pages/DeviceDetailsPage.tsx` | 三处被动提示改真按钮；去掉重复空态；通道中文化 |
| `pages/deviceCharts.tsx` | 通道中文化 |
| `pages/SettingsPage.tsx` | 「同步」→「刷新」；关于页通道中文化 |
| `shell/AppTopBar.tsx` | 已认证空中枢不再显示「未连接」 |
| `selectors.ts` / `selectors.test.ts` | 关注计数语义修正；`empty` 与会话失效拆分；断言 |
| `formatters.ts` | 新增 `formatReleaseChannel` |
| `dashboard.css` | 总览控件分组样式 |
| `scripts/visual-regression.cjs` | 4 条回归断言（无重复卡片、单一品牌、空集关注为 0、空集顶部非未连接） |

**审计人**：OpenCode UX/Usability Audit。**日期**：2026-10-01。
