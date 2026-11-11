<div align="center">
    <img src="apps/web/branding/icon.png" alt="观澜" width="120">
    <h1>观澜 · Guanlan</h1>
</div>

<p align="center">
    <em>电脑、服务器和 NAS 的运行状态，收在同一个页面里。</em>
</p>

<p align="center">
    <a href="https://guanlan.igng.net/">官网</a> ·
    <a href="https://github.com/IGNGserver/guanlan-monitor/releases">下载</a> ·
    <a href="docs/INSTALL.md">部署文档</a>
</p>

<p align="center">
    <a href="https://github.com/IGNGserver/guanlan-monitor/releases"><img src="https://img.shields.io/github/v/release/IGNGserver/guanlan-monitor?include_prereleases&style=flat-square&label=release&color=22c55e" alt="最新版本" /></a>
    <img src="https://img.shields.io/badge/Windows-10%2B-0078D4?style=flat-square" alt="Windows 10 及以上" />
    <img src="https://img.shields.io/badge/Linux-x64-64748b?style=flat-square&logo=linux&logoColor=white" alt="Linux x64" />
    <img src="https://img.shields.io/badge/Android-客户端-3DDC84?style=flat-square&logo=android&logoColor=white" alt="Android 客户端" />
    <img src="https://img.shields.io/badge/Web-控制台-64748b?style=flat-square" alt="Web 控制台" />
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-A855F7?style=flat-square" alt="许可证：MIT" /></a>
</p>

观澜是一套自托管的设备监控：中枢跑在你自己的机器上，Windows、Linux、Android 和浏览器端连过去，看 CPU、内存、磁盘、网络、显卡和风扇的实时数值与历史趋势。数据只发往你自己的中枢，没有托管后端。

## 功能

- **一套界面，两处渲染**：桌面端和中枢网页端用的是同一份界面代码，排布和图表一致，换设备不用重新学。
- **按实例拆开看**：CPU 核心、每一块硬盘、每一张网卡、每一块显卡、每一只风扇各自成列，看的是单个硬件而不是整机平均。
- **实时到历史都有**：查询间隔可选 1 / 2 / 5 秒，也能拉 5 分钟到 7 天的趋势。
- **无人登录也上报**：安装包会注册机器级服务（Windows 服务 / SYSTEM 计划任务，Linux systemd system 单元），注销或关窗口都不影响采集。
- **缺的传感器就留空**：主板或驱动没暴露的读数显示为空，不拿 0 冒充，也不因此挡住设备上线。

## 下载

安装包都在 [GitHub Releases](https://github.com/IGNGserver/guanlan-monitor/releases/latest)。

| 平台 | 文件 |
|---|---|
| Windows 10/11 | `DeviceStateConsole-Windows-Setup-v<版本>.exe`（安装版）<br>`DeviceStateConsole-Windows-Portable-v<版本>.zip`（便携版） |
| Linux x64 | `DeviceStateConsole-Linux-Install-v<版本>.deb`（Ubuntu / Debian amd64） |
| Android | `DeviceStateConsole-Android-v<版本>.apk` |

装完打开客户端，填中枢地址和访问密钥就能用。中枢还没部署的话，先看 [部署文档](docs/INSTALL.md)。

## 能看到什么

| 观测对象 | 指标 |
|---|---|
| 处理器 | 使用率、频率、温度（Package / Core） |
| 内存 | 占用、物理与已提交内存、历史水位 |
| 磁盘 | 挂载点容量、读写速率、温度 |
| 网络 | 收发速率、带宽、历史流量日历 |
| 显卡 | 核心负载、编解码负载、频率、显存、核心温度 |
| 风扇 | 转速，按风扇实例展示 |

网页端的时间范围是实时 / 5 分钟 / 1 小时 / 6 小时 / 24 小时 / 7 天。

## 实时和历史的边界

- 查询只在面板展开、页面可见、登录有效时发起，页面切走就停。
- 中枢每 5 秒发一次 challenge，只接受匹配的 pong 续期，租约 15 秒。
- 每个查询先 ACK 再返回，结果要过 schema 校验，5 秒截止。
- 同一份结果供所有观看者共用，设备端每个主题大约每秒最多采集一次。
- 实时曲线最多留 120 个点（2 分钟），缺失处留断点，不写进历史库。

## 文档

- [部署与安装指南](docs/INSTALL.md)——静默安装参数、`guanlan-agent` 命令、中枢 Compose 部署、外部 MySQL/Redis、TLS 反代、发布规则
- [可信实时监控](docs/TRUSTED_REALTIME_MONITORING.md)——实时通道的租约与查询语义
- [外部数据库](docs/EXTERNAL_DATABASE.md)——权限 SQL、迁移与延迟参数
- [版本与发布规范](RELEASE.md)、[贡献指南](CONTRIBUTING.md)

## 许可

[MIT](LICENSE) © [IGNGserver](https://github.com/IGNGserver)
