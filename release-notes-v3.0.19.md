# 观澜 v3.0.19 测试版

修复 v3.0.18 中导致“安装成功但从不采集上报”的缺陷，并把无 GUI 验收设为发布闸门。

### 修复

1. **机器级服务首次启动时把 `autoStartCollector` 写成了 `false`**
   - v3.0.18 中，服务首次启动会创建一份默认配置文档，其中的 `autoStartCollector`
     是交互式默认值 `false`；随后写入的“自动开始采集”只有在该键**完全缺失**时才会补上，
     而它已经被显式写成了 `false`，于是采集器永远不启动。
   - 结果：Windows 与 Linux 都是“服务已运行、配置已写入，但一条数据都不上报”。
   - 修复：
     - 服务安装时就把机器级配置文档按“持续采集”默认值落盘（`autoStartCollector: true`）；
     - 服务模式的守护进程改为使用共享配置加载器，文件缺失或键缺失时一律按机器级语义处理，
       显式的 `false` 仍然被尊重。
   - 如果你已经装过 v3.0.18 并发现设备不上报，执行一次
     `guanlan-agent config set --auto-start on`（Windows 用管理员终端）即可，或直接改装 v3.0.19。

2. **发布闸门**
   - v3.0.18 的无 GUI 验收失败但仍然发布了 Release；现在 `publish` job 依赖
     Windows/Linux 两个无 GUI 验收 job，任一失败都不会产出 Release。

3. **验收强度**
   - 无 GUI 验收新增断言：服务默认必须持续采集（`autoStartCollector`）、采集器必须处于运行状态、
     重启服务后必须恢复上报，避免“服务起来了但没在采集”这类问题再次漏过。

### 说明

本版本延续 v3.0.18 的架构变更：单一 GUI 发行版、机器级 Agent 服务、
Windows `/S` + `/HUB= /KEY= /DEVICE= /VERIFY=` 无人值守安装、
Linux `GUANLAN_*` 环境变量无人值守配置，以及 `guanlan-agent` 无界面命令集。

本版本仅作为 GitHub prerelease 测试版发布，不更新 `latest`，不用于生产部署。
