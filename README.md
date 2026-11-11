<p align="right">
   <strong>简体中文</strong>
</p>
<div align="center">
    <img src="assets/icon.png" alt="观澜" width="120">
    <h1>观澜 · Guanlan</h1>
</div>

<p align="center">
    <em>实时掌控你的设备，无论是电脑、服务器还是 NAS，状态一眼尽收眼底。</em>
</p>

<p align="center">
    <a href="https://guanlan.igng.net/">官网</a>
</p>

<p align="center">
    <a href="https://github.com/IGNGserver/guanlan-monitor/releases"><img src="https://img.shields.io/github/v/release/IGNGserver/guanlan-monitor?include_prereleases&style=flat-square&label=release&color=22c55e" alt="最新版本" /></a>
    <img src="https://img.shields.io/badge/Windows-10%2B-0078D4?style=flat-square" alt="Windows 10+" />
    <img src="https://img.shields.io/badge/Linux-x64-64748b?style=flat-square&logo=linux&logoColor=white" alt="Linux x64" />
    <img src="https://img.shields.io/badge/Android-客户端-3DDC84?style=flat-square&logo=android&logoColor=white" alt="Android client" />
    <img src="https://img.shields.io/badge/Web-控制台-64748b?style=flat-square" alt="Web 控制台" />
</p>

## 功能亮点

*   **跨设备全覆盖**：支持 Windows、Linux、Android 以及网页端，一套系统管好所有设备。
*   **全方位监控**：CPU、内存、磁盘、网络、显卡、风扇……你关心的这里都有。
*   **私有化安全**：所有数据都在你自己部署的环境中，安全可控。
*   **极简交互**：无论是桌面端的实时概览，还是网页端的深度历史趋势图，都触手可及。

## 快速开始

### 下载客户端
前往 [GitHub Releases](https://github.com/IGNGserver/guanlan-monitor/releases/latest) 下载适合你设备的安装包：
*   **Windows / Linux 用户**：下载对应平台的安装包，运行即可。
*   **Android 用户**：下载 APK 安装。

### 连接监控中心
安装并启动后，填写你的监控中心地址与访问密钥，即可开启实时监控。

## 数据能力矩阵

| 观测对象 | 核心指标覆盖 |
|---|---|
| 风扇 | 转速（按实例展示） |
| 显卡 | 负载、编解码、频率、显存、核心温度 |
| 处理器 | 使用率、频率、温度（Package / Core） |
| 内存 | 占用率、物理与已提交内存、历史水位 |
| 磁盘 | 容量、读写速率、温度 |
| 网络 | 吞吐、带宽、历史流量日历 |

## 实时监控事实
- **更新间隔**：支持 1 / 2 / 5 秒可选（面板展开且页面可见时）。
- **实时同步**：设备端每秒最多采集一次，共用聚合结果，断点不写入历史库。
- **配置管理**：所有采集策略与敏感凭据均由本地配置管理，不强制随中枢同步。

详细部署与高级用法，请参考 [安装与部署指南](docs/INSTALL.md)。

---
*观澜采用开源协议发布，感谢使用。*
