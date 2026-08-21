# v0.2.214 测试版

## 共享桌面端与站点 UI 契约

- 明确 `packages/console-ui` 为桌面端和站点的唯一生产 UI 入口。
- 新增 `ConsoleSnapshot` 平台无关读模型名称，并保留 `DesktopSnapshot` 兼容别名。
- 将共享 adapter 的读状态、会话、Fleet 和本机 Agent 能力拆出独立 port 类型。
- 为 Web 路由增加共享 UI 入口边界检查，防止旧 Dashboard/SaaS 组件重新成为生产入口。
- 补充共享 UI 与平台外壳的架构契约文档。

## 验证范围

- 本地仅执行 Web/桌面 UI 边界、脚本语法和差异检查。
- TypeScript、测试、桌面端和 Web 端构建由 GitHub Actions 执行。
- 发布后使用 Windows GUI setup 验证安装结果。
