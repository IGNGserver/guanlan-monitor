# 观澜 v3.0.26 测试版

修复**升级路径**上的一个真实缺陷：从旧版本升级上来的机器可能装着“永不采集”的配置，
导致服务已运行、配置已写入、却一条数据都不上报。

### 修复

1. **旧版本遗留的 `autoStartCollector: false` 不会被纠正**
   - v3.0.18–3.0.21 的服务在首次启动时会把交互式默认值 `autoStartCollector: false`
     写进机器级配置（这是当时那个“装好了但永不上报”缺陷的残留）。
   - `service install` 出于“不覆盖运维显式配置”的考虑会**保留已有文档**，而配置版本号
     一直是 1，无法区分“运维主动关闭采集”和“旧版本写坏了”。
   - 于是升级后：服务正常注册并运行、中枢地址与访问密钥都正确写入、`configured: true`，
     但 `autoStartCollector: false`、`collectorRunning: false`、`connectionStatus: stopped`，
     永远不上报。CI 无法发现这一点，因为 runner 每次都是干净的。
   - 修复：
     - 配置 schema 升级到 **版本 2**；版本 2 的文档里 `autoStartCollector` 的取值一定是
       有意义的、可信的；
     - 服务模式下读取到**版本 1 且 `autoStartCollector: false`** 的文档时，执行一次迁移：
       开启采集并写入版本 2 后落盘，此后运维的显式关闭会被永久尊重；
     - `service install` 现在会以服务语义加载并**回写**文档，因此迁移在守护进程启动前
       就已完成并持久化（缺文档时创建、旧文档时升级）。
   - 新增两组回归测试：版本 1 的坏文档必须被迁移且迁移后显式 `false` 被尊重、
     交互式读取不得改动已记录的意图。

2. **本版本已通过的验证**（v3.0.25，同一套代码路径）
   - Linux 无 GUI 验收 9/9：`.deb` 无桌面安装 → 系统级 `guanlan-agent.service` 启用并运行 →
     桩中枢确认首次上报 → 重启服务后恢复上报 → 卸载保留机器级配置。
   - Windows 无 GUI 验收 8/8：静默安装（`/S` + `/HUB`/`/KEY`/`/DEVICE`/`/HOSTNAME`/`/VERIFY`）
     → 无人值守安装报告写入 → 服务 `Automatic`+`Running`(LocalSystem) → 已配置且采集器运行 →
     首次上报确认 → 重启服务后恢复上报 → 静默卸载（服务与安装目录移除、机器级配置保留）。
   - `Publish GitHub test release` 首次成功，Release 含全部资产（Windows GUI setup / portable /
     update、Linux GUI deb、Android APK 及各自 `.sha256` 与启动验收证据）。
   - 本机在真实无桌面 Windows 主机上复核：发布资产校验和一致、静默安装成功、
     服务以 LocalSystem 自动启动、配置正确写入 —— 并由此发现了上面这个升级路径缺陷。

本版本仅作为 GitHub prerelease 测试版发布，不更新 `latest`，不用于生产部署。
