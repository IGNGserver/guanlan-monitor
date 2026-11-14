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

站点侧的唯一事实来源是 `src/data/product.ts`，每条都标了出处（`README.md`、`docs/INSTALL.md`、
`docs/TRUSTED_REALTIME_MONITORING.md`、`docs/EXTERNAL_DATABASE.md`、`docs/CLIENT_UPDATES.md` 与 release notes）。
`tests/facts.spec.ts` 在测试阶段直接读取仓库文档，核对站点引用的关键事实仍然成立。

- 私有部署的电脑与服务器运行状态监控工具；
- 客户端矩阵：Web 控制台（可安装 PWA + 会话级离线快照）、Windows 桌面端、GNOME Linux 桌面端、Android 客户端（含三款主屏幕小组件）；
- 监控内容：自定义设备分组、舰队趋势与异常汇聚、CPU、内存、磁盘与虚拟化宿主机存储池（PVE / LVM-thin / ZFS / NFS）、网络与 90 天流量日历、显卡、风扇，以及一级标签直达的进程与 Docker 容器实时双向直查；
- 下载与更新：只通过产品仓库的 GitHub Releases 分发安装包，设备端经仓库静态 `updates.json` 校验字节数与 SHA-256 升级；
- 中枢部署：Docker Compose（镜像来自 GHCR），支持四容器全栈与 `docker-compose.external.yml` 外部 MySQL / Redis 模式，客户端与 Agent 使用同一公开入口（默认端口 38472）。

### 发布通道（2026-11-14 核实）

产品当前最新正式稳定版为 `v3.0.172`，最新测试版构建为 `v3.0.174`（`prerelease=true`）。站点在构建时读取 Releases，
取「最新一个资产命名符合产品发布规则的发布」，如实标注 `prerelease` / 正式版，并在测试版横幅中指引生产环境前往「全部版本」选用最近正式版；
拿不到 API 时使用 `product.ts` 中核对过的烘焙值（`FALLBACK_RELEASE`）。

## 当前状态（2026-11-14）

- 技术栈：Astro 7 静态站点 + three.js，源码在 `website/`；
- 页面：首页（十段长滚动叙事）、`/download/`、`/deploy/`、404；
- 视觉方向与 3D 源资产：见 `design/DESIGN.md`；
- 已部署上线：Cloudflare Pages 项目 `guanlan-website`，正式域名 `https://guanlan.igng.net/`；
  `.github/workflows/website.yml` 在 `main` 和正式发版后自动构建并部署（见 `docs/HOSTING.md`）。

## 页面结构

| 路径 | 内容 |
| --- | --- |
| `/` | § 00 首屏 · § 01 剖面（七层观测单元 GL-01，对应硬件与存储池指标）· § 02 数据流（常规 HTTP 补传 + 实时 WebSocket 双向租约与凭据冲突重置）· § 03 实时查看（支持组内切换机器、⌘K 直达、进程 GPU/磁盘排序与悬停固定、容器筛选）· § 04 舰队与分组（设备组树、断口趋势、需关注、存储池、流量日历）· § 05 终端与韧性 · § 06 无人值守安装 · § 07 中枢（内置全栈 / 外部数据库切换）· § 08 安全边界 · § 09 下载 |
| `/download/` | 当前发布的全部资产（直链 + `.sha256`）、各平台说明、无界面安装命令、校验方法、中枢地址 |
| `/deploy/` | 中枢部署：准备、`.env`、启动、使用已有 MySQL / Redis、反向代理与 TLS（含 `DSC_TRUSTED_TLS_PROXY_CIDRS` 与实时通道 WebSocket 路径）、接入设备、升级与备份 |

## 语言策略

- 仅中文。英文名与字标未在产品仓库定案，站点不提供英文版，也不另造译名；罗马字只用 `Guanlan`（标识符）。

## 内容原则

- 只陈述产品仓库当前支持的事实，不编造路线图；已发布安装包矩阵仅列 Windows / Linux / Android，不为尚未发包的平台提供下载入口；
- 下载链接指向产品仓库的 Releases，不在本仓库托管安装包；
- 演示用的数值一律标注「示意数据」；控制台与总览界面是官网重绘的示意，不冒充产品截图；
- 3D「观测单元 GL-01」是虚构的隐喻仪器，文案明确说明，不暗示观澜是硬件产品；
- 品牌名：中文显示「观澜」；标识沿用产品图标的几何（屏幕 + 琥珀脉冲 + 青色在线点），不另造字标。
