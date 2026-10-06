# 设备状态控制台（观澜 / guanlan-monitor）· 项目 Agent 规范

只写本仓库与设备级规范的差异。Git 纪律、worktree、冲突处理见 `~/.qoder/coder-rules/global-rules.md`。

Collaboration: solo
Baseline: main
Default branch: main
Release: manual-on-explicit-request（不再每次开发自动发测试版）
Validation: `pnpm lint`、`pnpm typecheck`、`pnpm verify:version` + 下方测试清单
Worktree: `~/项目/.wt/设备状态控制台/<slug>`

## 这是什么

跨设备监控中枢：pnpm monorepo（Electron 桌面端 + Web + agent），部署在 NAS 的 Docker 里，Windows/Linux/Android 客户端上报。`main` 是开发线，不代表稳定版。

## 验证命令（必须真实执行）

- 安装：`pnpm install`
- 静态：`pnpm lint`、`pnpm typecheck`、`pnpm verify:version`
- 边界：`pnpm check:desktop-ui-boundaries`、`pnpm check:web-ui-boundary`、`pnpm check:adapter-contracts`
- 测试：`pnpm test:adapter-contracts`、`pnpm test:ui-helpers`、`pnpm test:workspace-contracts`、`pnpm test:renderer-security`、`pnpm test:hub-connection`、`pnpm test:electron-visual`、`pnpm test:window-material`
- 完整：`pnpm build`（**只在 CI 跑，见下方限制**）

## 与全局规范的差异（本仓库特有约束）

以下几条约束的是**手段与缺省行为**，不是拒绝用户授权的依据（见设备级规范第 0 节"授权语义"）：

- 本机允许 `pnpm install` 与 `pnpm dev` 做交互开发（`CONTRIBUTING.md` 明确许可），但**默认不在本机产出交付物、不部署**。
- **交付物的构建、打包、Docker 镜像构建一律走 CI**：需要构建结果时读取 GitHub Actions 的 run / artifact / image / deployment 状态；本机只允许不产生交付物的静态检查（版本一致性、workflow 语法）与 Git 操作。用户明确要 Agent 在本机跑构建时按其指示执行并说明与 CI 的产物差异，不得以本条为由拒绝。
- 构建/测试/打包/镜像发布/部署**优先**落在 `.github/workflows/` 的 job 里，由 Actions runner 或受控 GitHub environment 执行；`deploy/*.ps1`、Gradle、Go、pnpm、Docker 等脚本由 workflow 调用。缺对应 workflow 时先补 workflow（补 workflow 属于被授权范围时直接补），不得用本地手搓产物替代 CI 结论。
- 代理不得在本机安装任何交付物（含 `/S` 静默安装）、注册系统服务、开机自启或安装驱动——**这是缺省行为，不是禁令**：用户明确要求安装/自启/部署时即视为授权，直接代为执行并验证，回报版本号与卸载/回滚方式，不要只丢一条命令让用户自己跑。
- 生产与测试环境部署默认不自动发生。用户点名要部署（例如"发到 NAS 生产"、"更新那台 Windows 开发机"）即为授权：走本仓库受控通道完成（`deploy-production.yml` / `deploy-test.yml` / `update-agents-test.yml` + 固定版本镜像），执行到底并回报 environment 部署记录、镜像 tag 与健康检查；不得因"规范默认不部署"而拒绝或反复索要确认。
- 部署手段受限而非目的受限：不得从工作区源码手搓生产镜像、不得部署 `latest` 除非用户明确选它、不得绕过 workflow 直接 scp 交付物。
- `deploy-production.yml` 等 workflow 的触发权限属于用户；未要求时不触发，要求时即触发。
- 仓库根的 `AUDIT.md`、`AUDIT_REMEDIATION.md`、`NEEDS_SOL_REVIEW.md`、`FRONTEND_AUDIT_2026-09-26.md`、`UX_AUDIT_REPORT.md` 是历史审计快照，**不得当作待办清单自动执行**，只作背景。
- 不提交 `.next`、`dist`、`*.tsbuildinfo` 等生成文件。

## 发布（2026-09-27 起：取消"每次开发自动发测试版"）

- **默认不发版。** 完成开发只做到：提交并推送 `main` → `ci.yml` 跑校验。**不** bump 版本号、**不**建 tag、**不**创建 GitHub Release、**不**下载资产。旧规范里"每次开发后自动递增 patch 并触发测试版 Release、必须等 workflow 完成才算结束"的要求已废止，不要再据此结束任务。
- 只有你明确说"发布"时，才执行一次 `RELEASE.md` 的 Release Steps：更新根 `VERSION` → 同步 `package.json` 等所有 manifest → 提交发布准备改动 → `git tag vX.Y.Z` → `git push origin main --follow-tags` → 等 tag 触发的 `release-test.yml` 与 `docker-publish.yml` 跑完 → 核对 Release 与资产。
- 说"发布 release"默认仍指测试版（prerelease）；测试版不得被当作稳定安装源或生产部署依据。只有明确要求"正式发布"才允许覆盖 `latest`、上传正式安装包或部署生产。
- 版本号未经明确允许只递增第三位（patch），前两位保持不变；`VERSION` 与所有 package manifest 必须同步（`pnpm verify:version` 会检查一致性）。
- 发布链任一环节失败（workflow 失败、Release 未生成、资产缺失、sha256 不匹配）不得宣称完成，应继续排查或明确报告阻塞原因；Windows setup 资产需下载并校验 sha256 后才算交付。
- 生产运行从 Docker Hub 拉取指定固定版本镜像（或你明确选 `latest`），不得用未测试的工作区源码构建生产镜像；`main` 的推送本身不等于可安装版本。
- **Release 资产命名必须明确包含系统与安装/便携属性**：Windows setup（支持 `/S` 静默安装与无界面参数化配置）、Windows portable、Windows update、Linux install（内含系统级 systemd 服务与静默配置）、Android。**不再单独发布 CLI 发行资产**——无桌面场景的安装、配置、自启动与上报能力内建于桌面版安装包、随包的 `guanlan-agent` 命令以及机器级 agent 服务中。
- 权威流程见 `RELEASE.md`（142 行）与 `CONTRIBUTING.md`。

## 环境事实（不含凭据）

- 运行位置：NAS 上的 Docker Compose（Hub 服务端）+ Windows/Linux 桌面端与机器级 agent；入口与端口见部署文档，凭据只在受控 environment 与本机配置里。
- CI/发布触发器：`ci.yml` 由 push main/master 与所有 PR 触发；`release-test.yml`、`docker-publish.yml` **只由 `v*.*.*` tag 触发**（docker-publish 另支持手动 dispatch）；`deploy-production.yml`、`deploy-test.yml`、`update-agents-test.yml`、`inspect-agents-test.yml`、`performance-audit.yml` 全部是 `workflow_dispatch` 手动触发。
