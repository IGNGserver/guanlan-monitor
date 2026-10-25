# 官网定位与范围（SITE）

> 本文为后续开发者（含 AI 会话）提供站点上下文。范围或技术决策变化时同步更新本文件。

## 是什么

观澜 / Guanlan 的产品官网：介绍产品、展示真实功能、提供下载入口与中枢部署说明，
并作为搜索引擎与 AI 工具的可引用入口。站点源码位于产品仓库的 `website/`：

| 事项 | 归属 |
| --- | --- |
| 产品功能、版本、发布资产、产品文档 | 产品仓库 `IGNGserver/guanlan-monitor`（`website/` 之外） |
| 页面、样式、静态资源、3D 源资产、SEO、站点文案 | `IGNGserver/guanlan-monitor/website/` |

## 产品事实（引用时必须与产品仓库对齐）

站点侧的唯一事实来源是 `src/data/product.ts`，每条都标了出处（产品 README、`docs/TRUSTED_REALTIME_MONITORING.md`、
release notes）。`tests/facts.spec.ts` 会在 CI 上拉取产品 README，核对站点引用的关键事实仍然存在。

- 私有部署的电脑与服务器运行状态监控工具；
- 客户端矩阵：Web 控制台、Windows 桌面端、GNOME Linux 桌面端、Android 客户端；
- 监控内容：CPU、内存、磁盘、网络、显卡、风扇等实时数据与历史趋势；实时查看（进程、Docker）目前在测试版中；
- 下载与安装：只通过产品仓库的 GitHub Releases；
- 中枢部署：Docker Compose（镜像来自 GHCR），客户端与 Agent 使用同一公开入口（默认端口 38472）。

### 发布通道（2026-10-24 核实）

产品当前最新正式版为 v3.0.167（GitHub Latest）；`release-test.yml` 也支持测试版通道，因此站点不能假设
每个 release 都是稳定版。站点在构建时读取 Releases，取「最新一个资产命名符合产品 README 发布规则的发布」，
并如实标注 `prerelease` / 正式版；拿不到 API 时使用 `product.ts` 中核对过的烘焙值（`FALLBACK_RELEASE`）。
`release.ts` 会分页查找，避免正式版被大量测试版挤出第一页。

## 当前状态（2026-10-25）

- 技术栈：Astro 7 静态站点 + three.js，源码在 `website/`；
- 页面：首页（长滚动叙事）、`/download/`、`/deploy/`、404；
- 视觉方向与 3D 源资产：见 `design/DESIGN.md`；
- 已部署上线：Cloudflare Pages 项目 `guanlan-website`，正式域名 `https://guanlan.igng.net/`；
  `.github/workflows/website.yml` 在 `main` 和正式发版后自动构建并部署（见 `docs/HOSTING.md`）。

## 页面结构

| 路径 | 内容 |
| --- | --- |
| `/` | § 00 首屏 · § 01 剖面（七层观测单元，逐层对应硬件指标）· § 02 数据流（Agent → 中枢 → 终端，可模拟断网补传）· § 03 实时查看（重绘的控制台示意，可切换间隔、排序、模拟超时）· § 04 终端 · § 05 无人值守安装 · § 06 中枢 · § 07 安全边界 · § 08 下载 |
| `/download/` | 当前发布的全部资产（直链 + `.sha256`）、各平台说明、无界面安装命令、校验方法、中枢地址 |
| `/deploy/` | 中枢部署：准备、`.env`、启动、反向代理与 TLS（含实时通道 WebSocket 路径）、接入设备、升级与备份 |

## 语言策略

- 仅中文。英文名与字标未在产品仓库定案，站点不提供英文版，也不另造译名；罗马字只用 `Guanlan`（标识符）。

## 内容原则

- 只陈述产品仓库当前支持的事实，不编造路线图；版本与平台矩阵以产品仓库 `README.md` / Releases 为准；
- 下载链接指向产品仓库的 Releases，不在本仓库托管安装包；
- 演示用的数值一律标注「示意数据」；控制台界面是官网重绘的示意，不冒充产品截图；
- 3D「观测单元 GL-01」是虚构的隐喻仪器，文案明确说明，不暗示观澜是硬件产品；
- 品牌名：中文显示「观澜」；标识沿用产品图标的几何（屏幕 + 琥珀脉冲 + 青色在线点），不另造字标。

## 已知的产品侧不一致（需在产品仓库处理，站点不替产品做决定）

- README 的下载链接指向 `/releases/latest`，该地址目前落在 v0.2.271（旧资产命名，与 README 描述的安装包名不符）；
- README 要求「仅当 server 只能从受信代理访问时才设置 `TRUST_PROXY=true`」，而 `docker-compose.yml` 中 server 的
  `environment` 固定写死了 `TRUST_PROXY: "true"`。站点 `/deploy/` 按 README 表述。
