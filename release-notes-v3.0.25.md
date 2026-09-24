# 观澜 v3.0.25 测试版

修复无 GUI 验收中 Windows 侧的流水线缺陷，并让无人值守安装留下可审计的安装报告。

### 修复

1. **Windows 无 GUI 验收：桩中枢标记路径跨步骤丢失（v3.0.22 的修复）**
   - 验收第 5 步（静默安装 + `/HUB` 自动配置 + `/VERIFY` 确认首次上报）在 v3.0.21 中
     **已经通过**：服务已注册为自动启动、采集器在运行、首次上报在 180 秒内确认。
   - 第 6 步失败的原因是流水线自身的缺陷：标记文件路径在步骤内用 `$env:` 赋值，
     而 GitHub Actions 的步骤之间不继承环境变量，导致后续步骤读到空路径、
     `Test-Path` 抛错。
   - 修复：访问密钥提升为 job 级 `env`，标记文件路径改为在每个步骤内按 `RUNNER_TEMP` 推导
     （`jobs.<id>.env` 不接受 `runner` 上下文，v3.0.22 一度因此让工作流文件失效，
      v3.0.23 已改为不依赖上下文表达式的写法）。
   - 结论：v3.0.19/20/21 暴露的四个 Windows 缺陷（`autoStartCollector` 首次启动为 false、
     服务找不到采集器、服务参数未加引号、`config set` 拒绝全局参数）在 v3.0.21 中均已修复并验证通过。

2. **无人值守安装报告**
   - 静默安装现在会在 `%ProgramData%\Guanlan\install-report.txt` 记录本次安装解析到的
     `installDir`、`configDir`、`hub`、`deviceId`、`hostname`、`serviceSwitch`、
     `verifySeconds`、是否提供了访问密钥，以及 `service install`、`config set`、
     `wait-for-upload` 三步各自的退出码。
   - **访问密钥绝不写入该文件。** 这既是无人值守安装的审计产物（Intune/SCCM 批量下发后
     可核对每台机器实际收到的参数），也保证失败时能直接定位到是哪一步没成功。
   - Windows 无 GUI 验收失败时会打印该报告以及 `status --json`、服务状态、配置目录与后端日志尾部。

3. **Windows 无 GUI 验收第 8 步：卸载程序名按字面量匹配失败**
   - v3.0.23 中 Windows 前七步已全部通过（静默安装 → 自动配置 → 服务 Automatic+Running →
     采集器运行 → 首次上报确认 → 重启后恢复上报）。
   - 第 8 步失败是流水线自身的编码问题：步骤脚本以无 BOM 的 UTF-8 写入磁盘，
     Windows PowerShell 5.1 会把脚本里的中文产品名字面量（`观澜`）读成乱码，
     于是找不到 `Uninstall 观澜.exe`。
   - 修复：改为按 `Uninstall*.exe` 模式发现卸载程序，不在工作流里写任何非 ASCII 字面量
     （已扫描确认整个 release 工作流的 run 块中不再含非 ASCII 字符）。

4. **Windows 卸载断言改为按"观测结果"判定**（v3.0.25）
   - 在一台真实 Windows 主机上实测确认：对 electron-builder 生成的卸载程序，
     `Start-Process -Wait` 配合 NSIS 的 `_?=<目录>` 形式会返回 -1 且**不执行任何卸载**；
     而直接以 `/S` 调用可以正确移除服务与安装目录。
   - 验收改为直接调用 `/S`，并以"服务已消失、安装目录已删除、机器级配置仍保留"作为断言，
     不再依赖启动进程的退出码（该退出码在提权重启场景下不代表卸载结果）。
   - 同时修复卸载遗漏：`bin\guanlan-agent.exe` 是用 `CopyFiles` 创建的，NSIS 不会自动登记删除，
     现在卸载时显式删除该文件与 `bin` 目录，并结束残留的采集器进程。

5. **Linux 无 GUI 验收**保持全部通过（安装 → 系统级服务自启 → 桩中枢确认上报 →
   重启后恢复上报 → 卸载保留配置，共 9 步）。

本版本仅作为 GitHub prerelease 测试版发布，不更新 `latest`，不用于生产部署。
