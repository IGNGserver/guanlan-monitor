# 观澜 v3.0.18 测试版

这是观澜的**单发行版架构**版本：不再区分 GUI 版与 CLI 版，只发布一个桌面端安装包；
同一份安装包在**没有桌面会话**的机器上也能完成安装、配置、开机自启并正常上报数据。

### 核心变更

1. **新增机器级 Agent 服务（无桌面会话也能上报）**
   - Windows：安装器注册原生服务 `GuanlanAgent`（LocalSystem、自动启动、失败自动重启）；
     若服务无法创建则回退为 `AtStartup` + SYSTEM 计划任务，**绝不使用需要登录的启动项**。
   - Linux：`.deb` 安装时启用系统级 `guanlan-agent.service`（`WantedBy=multi-user.target`，
     不依赖 `graphical-session`），专用 `guanlan` 系统账户运行，`Restart=always`。
   - 服务持有机器级配置（`%ProgramData%\Guanlan` / `/etc/guanlan`）并常驻采集与上报；
     关闭桌面端或注销登录都不会中断采集。

2. **Windows 静默安装与无人值守配置**
   - 安装器支持 `/S` 与 `/HUB= /KEY= /DEVICE= /HOSTNAME= /SERVICE= /VERIFY=` 开关。
   - `/VERIFY=<秒>` 会等待首次上报确认，超时返回退出码 3，便于 Intune/SCCM/Ansible 判定。
   - 访问密钥通过临时文件传递并在使用后立即删除，不会出现在进程参数中。
   - 卸载会停止并删除服务，默认保留机器级配置（`/REMOVECONFIG` 才删除）。

3. **Linux 无人值守安装**
   - `sudo GUANLAN_HUB=... GUANLAN_KEY=... apt-get install -y ./DeviceStateConsole-Linux-GUI-Install-v3.0.18.deb`
     即可完成安装 + 配置；也支持 `/etc/guanlan/agent.env` 或装后 `guanlan-agent config set`。
   - 修正安装包元数据：包名 `guanlan-desktop`、可执行名 `guanlan`（此前派生为中文包名与 `@dscdesktop`）。

4. **桌面端改为“连接或托管”**
   - 启动时优先连接机器级服务：有权限则全权管理，无权限则进入**只读**模式（新增脱敏
     `/api/status`），并在设置页明确提示需要管理员权限及对应命令，而不是给出会失败的控件。
   - 只有未安装服务时（便携版/开发模式）才自行拉起后端进程，保持原有行为。

5. **下架 CLI 发行版**
   - 删除 `dsc` 终端界面、CLI 安装包与引导脚本，以及不再发货的 GTK 版链路。
   - 无界面能力 1:1 迁移到随包的 `guanlan-agent`：`status`、`doctor`、
     `config get|set|validate|export|import`、`service install|uninstall|start|stop|status`、
     `collector start|stop|restart`、`probes status|detect`、`wait-for-upload`。
   - 中枢 `/api/updates` 同步移除 `windows-cli`/`linux-cli` 平台，避免返回已不存在的资产名。

6. **配置契约收敛与一致性修复**
   - 抽出共享配置包，消除同一份 schema 在 4 处重复实现的问题。
   - 修复 `autoStartCollector` 缺字段时静默表示“永不开始采集”的隐患：服务模式下按
     持续采集处理，显式关闭仍被尊重。
   - 修复以管理员身份写入的配置服务账户读不到的问题（文件跟随目录属主）。

7. **验证**
   - 新增无 GUI 验收流水线：Windows 与 Linux 各自完成静默安装 → 断言服务已启用并运行 →
     桩中枢确认收到上报 → 重启服务后确认恢复上报 → 静默卸载并确认服务移除、配置保留。
   - 新增 Linux 安装包配置的静态校验，纳入 CI。

本版本仅作为 GitHub prerelease 测试版发布，不更新 `latest`，不用于生产部署。
