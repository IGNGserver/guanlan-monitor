# 托管与部署（Cloudflare Pages）

> 正式站点：<https://guanlan.igng.net/>。站点源码在产品仓库 `guanlan-monitor/website/`，部署由
> `.github/workflows/website.yml` 完成。旧的独立仓库 `IGNGserver/guanlan-website` 已归档。

## 当前配置

| 项 | 值 |
| --- | --- |
| Pages 项目 | `guanlan-website`（Direct Upload） |
| 部署来源 | `IGNGserver/guanlan-monitor` 的 `website/` |
| 部署工作流 | `.github/workflows/website.yml` |
| 生产分支 | `main` |
| 构建命令 | `pnpm install --frozen-lockfile && pnpm build`（在 `website/` 下） |
| 发布目录 | `website/dist/` |
| 自定义域名 | `https://guanlan.igng.net/`（zone `igng.net`） |
| 默认别名 | `https://guanlan-website-fms.pages.dev/`（保留） |
| DNS | proxied CNAME `guanlan.igng.net` → `guanlan-website-fms.pages.dev` |

`SITE_URL` 固定为 `https://guanlan.igng.net/`，用于 canonical 与 `og:image`。CI、Pages 项目环境变量与
`astro.config.mjs` 的缺省值必须一致。产品根是 pnpm monorepo，但 `website/` 使用自己的
`package.json` / `pnpm-lock.yaml`，不并入根 workspace。

## 自动部署

`website.yml` 在这些时机运行：

- `push` 到 `main` 且改动涉及 `website/**`：构建并部署；
- `Release` 工作流创建完 GitHub Release 后发送 `repository_dispatch`（`release-published`）：
  重建站点，重新读取最新发布；
- `pull_request`：跑 `pnpm build` 与 Playwright，不部署；
- `workflow_dispatch`：手动构建与部署。

`release: published` 不能用于这条链路：Release 由 `GITHUB_TOKEN` 创建时，GitHub 不会为它触发新的工作流；
`repository_dispatch` 是例外。

需要两个 repository secrets：

| Secret | 用途 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | 最小权限 token，仅需 Cloudflare Pages:Edit |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账号 ID |

凭据只放 GitHub Actions Secrets，不写进仓库、文档、日志或前端产物。继续复用现有 Direct Upload 项目，
不要新建项目或改成 Git 集成。

## 构建参数

| 项 | 值 |
| --- | --- |
| 安装 | `pnpm install --frozen-lockfile`（Node.js ≥ 22.13，`packageManager: pnpm@10.33.0`） |
| 构建 | `pnpm build`（`astro check && astro build`） |
| 输出 | `dist/`（纯静态，含 404.html） |
| 响应头 | `website/public/_headers`：安全头、CSP、静态资源缓存 |
| 可选环境变量 | `GITHUB_TOKEN`：构建时读发布信息，避开匿名限流；`GUANLAN_OFFLINE=1`：离线构建，使用烘焙值 |

版本与下载直链在构建时读取 GitHub Releases 并烘焙；`src/data/release.ts` 会分页查找最新一个资产完整的
发布（不再只看前 10 条）。浏览器端当前不额外刷新，构建失败时使用 `product.ts` 中的人工核对值。

## 发布与回滚

- 正常发布：合并到 `main` 或发布新 Release，工作流自动部署；
- 回滚：Cloudflare Pages 项目 → Deployments 选择上一个成功部署恢复；
- 迁移前生产部署：`4f75f68b-413f-4f74-9acb-5d72f7a09e59`（2026-10-18，首版发布，提交 `2a04ce2`）；
  迁移后的首次自动部署 ID 在部署记录里补记，并以它作为新的回滚点；
- 域名变更：修改 DNS 前记录原值；当前是 proxied CNAME `guanlan.igng.net` → `guanlan-website-fms.pages.dev`，
  改动必须同步 Pages 自定义域名与三处 `SITE_URL`。

## 搜索收录与发现

- Google Search Console：域名资源 `sc-domain:igng.net` 已覆盖；`website/public/robots.txt` 的
  `Sitemap:` 行指向静态 `website/public/sitemap.xml`，新增页面必须同步更新。
- Bing Webmaster Tools：如需验证，按现有 `*.igng.net` 做法补 meta 或从 GSC 导入；删除验证 meta 会失去所有权。
- 站点没有统计脚本；唯一外部请求是构建时读取 GitHub Releases（浏览器端不请求第三方脚本）。

## 历史

- 2026-10-18：首版 Astro 站点上线 Cloudflare Pages，项目 `guanlan-website`，绑定 `guanlan.igng.net`。
- 2026-10-25：站点代码并入产品仓库 `website/`，改为 GitHub Actions 自动部署；独立仓库归档。
