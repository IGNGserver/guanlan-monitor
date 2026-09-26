# 观澜 v3.0.113 测试版

在 v3.0.112 之上，收掉对已部署版本做线上实测时新发现的**一条**缺陷。它不在原先那份 76 项清单里，是复验数据把它带出来的。仅作 GitHub prerelease 测试版发布，不更新 `latest`，不用于生产部署。

## body 在两套主题下都是纯白

复验逐项量线上渲染时，`html` 的背景正确跟随主题（浅色 `#f4f4f4`、深色 `#161616`），而 `body` 在两套主题下都实测为 `rgb(255, 255, 255)`。

原因还是这轮工作反复碰到的那个模式：`@carbon/react` 编译出的全局样式里有一条 `body { background: $background }`，用的是**未套主题**的 Sass 默认值（白），落在生效顺序的第 2 层，压掉了第 1 层 `workspace.tokens.css` 里那条主题感知的规则。平时看不见，是因为 `.guanlan-carbon-theme` 满屏盖住了 body；但触控板与手机的橡皮筋回弹会把这条白底露出来。

修法是在裁决层（第 3 层）重述 body 的背景与文字色——只有排在 Carbon 之后的层才能真正赢回来。

## globals.css 里的两处幻影引用

同一个文件里还有两处属于同一类错误，一并清掉：

- `html, body` 上的 `background: var(--cds-background, #f4f4f4)` 与 `color: var(--cds-text-primary, #161616)`。Carbon 的 `<Theme>` 把自定义属性挂在 `.guanlan-carbon-theme` 上，而自定义属性**不会向上继承**，所以在 `html`/`body` 上这两个引用永远未定义、永远走字面量 fallback。线上实测确认 `--cds-background` 在 `html` 上为空。这与 v3.0.110 里纠正的 `--cds-spacing-*` 是同一个陷阱。
- `:root { color-scheme: light }` 把浏览器原生控件（滚动条、表单控件、日期选择器）钉在浅色，即使控制台处于深色；实际生效的是 `WorkspaceContext` 写在 `<html>` 上的内联值，所以这条声明唯一决定的只是水合前的一瞬。

`::selection` 也从这里移除：`workspace.tokens.css` 已按主题给出 Carbon 自己的 `$selection` 值，本文件那份（蓝底白字）与它口径不同、又因来源顺序靠后而落空，属于同一个问题被两个文件各自回答。

登录页不受影响——`.loginShell` 自带完整的明暗背景。

## 边界

本版本不含安卓端改动与中枢后端行为变更；构建、检查、打包与镜像发布全部由 `.github/workflows/` 承担。

## 已知留待后续的一条（本版本未做）

登录页的明暗走 `prefers-color-scheme`，而控制台走用户在设置里选的 `dsc-theme`。于是把控制台设为深色后一旦会话失效回到登录页，会看到浅色页面。登录前没有应用状态可读，这个分界有一定合理性，但它是一次可感知的跳变，应作为独立决定处理，不塞进这一版。
