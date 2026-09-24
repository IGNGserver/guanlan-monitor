# 单发行版方案：无 GUI 场景下的安装、配置、自启动与上报

状态：**待确认**（Phase 0 未开始）
适用版本：从 `v3.0.18` 起
作者：代理分析（基于 `v3.0.17` 代码库现状）

---

## 0. 结论摘要

现在的痛点是**生命周期归属错了**：真正采数据的是 Electron 的子进程，而 Electron 必须有人登录、有桌面会话才能跑。于是"能看见"（GUI 版）和"无人值守也能跑"（CLI 版）被切成了两个发行版，用户必须二选一。

目标方案（业界主流形态，对标 Zabbix Agent / Netdata / Grafana Alloy / Elastic Agent / Tailscale / Docker Desktop）：

1. **把数据面从 GUI 进程里拿出来**，交给一个随 GUI 安装包一起安装、开机自启、无桌面会话也能运行的常驻服务：
   - Windows：原生 **Windows Service** `GuanlanAgent`（LocalSystem、自动启动、失败自动重启）
   - Linux：**system 级 systemd 单元** `guanlan-agent.service`（专用系统用户、`CAP_PERFMON`、`Restart=always`）
2. **Electron 桌面端降级为可选前端**：运行时先尝试连接本机服务（attach），连不上才退回今天的"自己拉子进程"模式（spawn）。GUI 只保留托盘 + 配置/查看能力。
3. **无 GUI 的四条配置通道**：静默安装参数 → 同一个发行体内的小型 CLI → 本机回环引导页 → 配置文件/环境变量。四条通道写的是同一份**机器级配置**，幂等且可脚本化。
4. **CLI 发行版整体下线**（`dsc` TUI、CLI zip、`install-cli.*`），但其能力 1:1 迁移到服务与 CLI 子命令，不丢任何一项。
5. 配置契约收敛为**一份机器级 JSON**（`%ProgramData%\Guanlan\agent.json` / `/etc/guanlan/agent.json`），并在 Go 侧抽出单一的 schema 包（今天同一份 schema 在 4 处重复实现）。

一句话验收标准：**在一台没有任何桌面会话的机器上，一条静默安装命令之内完成安装+配置，重启后无需任何人登录，中枢能看到该设备持续上报。**

---

## 1. 现状机制分析

### 1.1 三个平面

| 平面 | 代码 | 交付形态 |
| --- | --- | --- |
| 中枢（Hub） | `apps/server`（Fastify + Socket.IO + Redis/MySQL）、`apps/web`（Next.js 控制台） | Docker Compose / GHCR 镜像 |
| 采集（Agent） | `agents/`（Go：采集器 `device-state-console-agent`、本地后端 `device-state-console-agent-backend`） | 被打进 GUI 安装包与 CLI zip |
| 客户端 | `apps/desktop`（Electron，统一桌面端）、`android/`、`ios/` | GUI 安装包 / APK / IPA |

中枢与移动端不需要改动；本方案只动**采集平面 + 桌面端 + 安装/发布链路**。

### 1.2 发行版分裂：GUI 版 vs CLI 版

| 维度 | GUI 版 | CLI 版 |
| --- | --- | --- |
| 发布资产 | `Windows-GUI-Setup.exe`、`Windows-GUI-Portable.zip`、`Windows-GUI-Update.zip`、`Linux-GUI-Install.deb` | `Windows-CLI-Install.zip`、`Linux-CLI-Install.zip`、`install-cli.sh/.ps1` |
| 内容 | Electron 主/预加载/渲染 + `resources/agent/{agent,backend}` + PawnIO/LHM | `dsc`(TUI) + agent + backend + 安装脚本 + 硬件资源 |
| 配置入口 | 只有 GUI 界面 | `dsc` TUI / `dsc config set` / `install-agent.sh --server-url --secret` |
| 配置落盘 | Electron `userData`（**每用户**） | `DSC_CLI_CONFIG_ROOT` 或 `$XDG_CONFIG_HOME/device-state-console/`（每用户）；`install-agent.sh` 另写 `/opt/.../agent.env` |
| 自启动 | `app.setLoginItemSettings`（**登录项，需交互登录**） | Windows 计划任务 `AtStartup`+SYSTEM（`deploy/install-agent.ps1`）；Linux systemd **system** 单元 + 专用用户（`deploy/install-agent.sh`） |
| 无 GUI 可用性 | **不可用** | 可用（这是它存在的唯一理由） |
| 构建 | `release-test.yml` Windows/Linux job | `release-test.yml` "Build Windows and Linux CLI packages" → `deploy/build-cli-agent.ps1` |

### 1.3 GUI 版的真实运行机制

进程拓扑（`v3.0.17`）：

```text
用户登录 → 登录项启动 Electron(观澜.exe)
  └─ main.ts: 单实例锁 / 托盘 / 拦截 window-all-closed（关窗只隐藏）
       └─ controller.ts: LocalConfigStore(userData) + HubClient
            └─ agent-manager.ts: spawn backend
                 device-state-console-agent-backend
                   --listen 127.0.0.1:<随机端口> --bundle-root <resources/agent>
                   --config-root <userData> --parent-pid <electron pid>
                   --local-token-file <userData>/agent-ui.local-token
                 └─ backend: 拥有 agent-ui.config.json、sync-state、诊断日志、pending spool
                      └─ 采集器子进程（$DSC_AGENT_CONFIG_FILE=<configPath>）→ POST /api/agent/ingest
```

关键事实（附代码位置）：

- 后端是 Electron 的**子进程**，并被 `--parent-pid` 监视：Electron 一退，后端即退（`apps/desktop/src/main/agent-manager.ts:52-88`）。
- 配置根是 Electron `userData`（每用户），并带 4 条 legacy 每用户路径做迁移（`controller.ts:53-69`）。
- 自启动仅 `app.setLoginItemSettings({ openAtLogin })`（`controller.ts:106,317`），文档也明确写着"**The new app is a tray application, not a service**"、"Linux ... **no systemd unit**"（`docs/unified-desktop/architecture.md:47`、`process-lifecycle.md:37-39`、`migration-plan.md:31`）。
- 后端**已经支持无 parent 独立运行**：`--parent-pid` 是可选参数，CI 冒烟测试就是不带该参数启动的（`release-test.yml:211-235`）。
- 后端已有：Windows job object、父进程看护、采集器崩溃指数退避重启、pending spool 重放、诊断日志、`/api/control/check-connection`（`agents/cmd/windows-agent-backend/main.go`）。
- 安装器（NSIS，`apps/desktop/build/installer.nsh`）目前只做三件事：装 PawnIO 驱动、注册 SYSTEM 计划任务 `DeviceStateConsoleHardwareSensors`（`install-hardware-helper`）、清理历史版本。**不注册任何开机服务、不写任何配置、不解析任何命令行参数**。
- Linux `.deb` 由 `electron-builder --linux deb` 生成（`release-test.yml:324-336`），包内含 `resources/agent/*`，但**没有 `afterInstall`，没有 systemd 单元**，装完什么都不会自启。

### 1.4 CLI 版的真实运行机制（可复用资产）

- `dsc` **不是独立实现**，而是本地后端 HTTP API 的瘦客户端（`agents/cmd/dsc/main.go:470-560` 的 `backendClient`）。
- 已有子命令：`status`、`start|stop|restart`、`shutdown`、`doctor`、`probes status|detect`、`config get|set|validate|export|import|push`、`version`；另有 `--json` 与 `--secret-stdin`（避免密钥进进程参数）。
- ⚠️ **`update` 不是 `dsc` 的子命令**，它属于采集器二进制（`agents/main.go:527`），是 `install-agent.*` 形态下唯一的升级通道，**只能改不能删**（见 Phase 5）。
- ⚠️ `dsc status` 今天**恒返回 0**（backend 没跑也返回 `{"running":false}`）；只有 `doctor` 会因连接/探测失败返回 1。方案里 3/4/5 的语义化退出码是**新增契约**，不是既有行为。
- ⚠️ dsc/TUI 里**没有任何服务注册代码**；CLI 侧的开机自启完全由 `deploy/install-agent.{sh,ps1}` 决定。
- Linux 自启动：`deploy/install-agent.sh` 写 `/etc/systemd/system/device-state-console-agent.service`（`User=dsc-agent`、`EnvironmentFile=agent.env`、`Restart=on-failure`、`WantedBy=multi-user.target`、`systemctl enable --now`），并有 `run-agent.sh` 做重启循环。
- Windows 自启动：`deploy/install-agent.ps1` 注册 `AtStartup` + `SYSTEM` + `RunLevel Highest` 计划任务，带 `RestartCount/RestartInterval`；`deploy/install-agent-service.ps1` 是真正的 `sc.exe` 服务方案，但**依赖外部 nssm，且没有任何 workflow 调用它**。
- 采集器配置契约：环境变量 `DSC_SERVER_URL` / `DSC_AGENT_SECRET` / `DSC_DEVICE_ID` / `DSC_HOSTNAME` / `DSC_AGENT_CONFIG_FILE`（`agents/main.go:559-577`）。
- **额外依赖**：`.github/workflows/update-agents-test.yml` 把 `DeviceStateConsole-Linux-CLI-Install-vX.Y.Z.zip` 当作远程机队批量更新的传输载体（下载→校验→解压→SSH 分发→重启 `device-state-console-agent.service`）。删 CLI 版必须同时改造这条链路。

### 1.5 无 GUI 场景的 6 个断点（为什么"只留 GUI 版"现在做不到）

| # | 断点 | 证据 |
| --- | --- | --- |
| 1 | **生命周期绑定**：数据面是 GUI 的子进程，父进程退出即停 | `agent-manager.ts` `--parent-pid` |
| 2 | **自启动绑定登录**：只有登录项，没有开机级服务/任务 | `controller.ts:106,317` |
| 3 | **配置绑定用户**：配置根在 `userData`，服务账户/SYSTEM 下不可达、不可写 | `controller.ts:53-69` |
| 4 | **配置入口只有 GUI**：安装包内没有 CLI，安装器不解析参数、不写配置 | `installer.nsh`（无 `$CMDLINE` 解析） |
| 5 | **安装器无开机动作**：NSIS 不注册服务；deb 无 `afterInstall`/systemd 单元 | `installer.nsh`、`release-test.yml:324-336` |
| 6 | **能力被切两半**：想要无人值守就只能装 CLI 版，想要界面就只能装 GUI 版 | 1.2 节 |

### 1.6 顺带要还的债

- **同一份配置 schema 有 4 份实现**：`agents/main.go`、`agents/cmd/dsc/main.go`（`agentLocalConfig`）、`agents/cmd/windows-agent-backend/main.go`、`packages/shared/src/index.ts`。任何字段改动都要改 4 处，极易漂移。→ 抽出 Go 侧 `agents/internal/agentconfig`。
- **遗留实现仍活着**：`linux-agent-gui/`（GTK4）在 `ci.yml:122` 仍被构建，但已不在发布路径；`deploy/build-windows-agent-setup.ps1`（Inno）已无 workflow 引用，文档却仍称其为当前方案。→ 下架 CLI 版时可一并清理。
- **`scripts/verify-windows-installer-config.mjs`** 对安装器与 `release-test.yml` 的步骤标题做了逐字断言（34 条），任何安装器改造必须同步更新它，否则 CI 红。
- **Electron 桌面端在 Linux 上其实没有任何自启动**：`app.setLoginItemSettings` 在 Electron 37 的 `electron.d.ts` 里标注为 `@platform darwin,win32`，deb 里既无 systemd 单元也无 autostart .desktop。也就是说 Linux GUI 版今天**连交互登录后的自启都没有**（GTK 遗留版反而有 `systemctl --user enable`）。这让"GUI 版在 Linux 上不可无人值守"的结论比我原先判断的更严重。

### 1.7 一处必须澄清的事实（两份分析曾冲突）

`deploy/build-linux-agent-gui.sh`（GTK 版）与 `release-test.yml` 里的 `electron-builder --linux deb` **产出同名资产** `DeviceStateConsole-Linux-GUI-Install-vX.Y.Z.deb`，但**发货的是 Electron 那一个**：`release-test.yml` 的 `linux-gui` job 标题即 "Build unified Linux Electron GUI asset"，且只上传 `release/linux-desktop/*.deb`。GTK 版仅在 `ci.yml:122` 被构建并做字段断言，**从不进入 Release**。因此：

- 发布资产里的 Linux GUI = Electron 应用（内含 `resources/agent/{agent,backend}`），不是 GTK 应用；
- GTK 链路（`linux-agent-gui/` + `deploy/build-linux-agent-gui.sh`）已是纯 CI 负担，Phase 5 可安全删除；
- 同时也说明 **Linux 侧今天完全没有系统级自启**（Electron 无自启、GTK 只有 user 级且未发货）。

### 1.8 安全债：固定端口 + 空 token

WinUI 与 GTK 两个前端都以 `127.0.0.1:17891` 启动 backend 且**不传 token**；后端在 token 为空时 `authorizeLocalRequest` 直接放行（`agents/cmd/windows-agent-backend/main.go:713-716`）。后果：本机任意进程都能调用 `/api/state`（返回**含明文密钥**的完整配置）、`PUT /api/config`、以及采集器启停。Electron 与 `dsc` 用"随机端口 + 0600 token 文件"规避了这一点。

新方案的机器级服务要长期监听固定端口，**绝不能沿用空 token 模式**：必须使用受限 ACL 的 token 文件（Windows 仅 SYSTEM+Administrators），并对非提权 GUI 只暴露脱敏状态接口（§2.6 已按此设计）。

### 1.9 现成可复用的资产（好消息）

- 后端已支持无 parent 独立运行，且已具备崩溃自愈、spool、诊断能力。
- Windows 计划任务 / systemd system 单元的安装代码已存在（`deploy/install-agent.ps1`、`deploy/install-agent.sh`），可以直接移植。
- 采集器已有环境变量配置契约。
- CI 已跑通 `/S` 静默安装 + 静默重装 + 启动验收（`release-test.yml:164-210`）。
- Go 侧 `golang.org/x/sys` 已是间接依赖，实现原生 Windows 服务（`x/sys/windows/svc`）无需新增第三方依赖。

---

## 2. 目标方案

### 2.1 设计原则

1. **数据面与控制面分离**：只有常驻服务采数据、上报；GUI / CLI / 引导页都只是控制面客户端。
2. **一次安装一个产品**：GUI 安装包内同时包含服务与桌面端，用户不再需要在两个发行版之间选择。
3. **无人值守优先**：任何配置动作都必须存在非交互等价物，且不要求 TTY。
4. **可编排可验证**：每条通道都能用一条命令判定成败（退出码 + `--json`）。
5. **服务是权威**：配置写入只有一条路径（服务），避免 GUI 与服务双写冲突。

### 2.2 目标进程与服务拓扑

```text
开机（无人登录）
 └─ OS 服务管理器
     └─ GuanlanAgent / guanlan-agent.service   ← 唯一数据面（SYSTEM / 专用用户）
          ├─ 机器级配置 agent.json（权威）
          ├─ 回环控制 API 127.0.0.1:17891（token 鉴权）
          ├─ 采集器子进程（崩溃指数退避重启 + job object/进程组兜底）
          └─ pending spool → POST /api/agent/ingest（Bearer ACCESS_KEY）

用户登录（可选）
 └─ 观澜.exe（Electron 托盘）
      ├─ 探测 127.0.0.1:17891 → 健康则 attach（读状态；写配置走提权）
      └─ 不健康则 spawn 自带后端（开发/便携模式，保持今天的行为）
```

| 平台 | 服务实体 | 账户 | 自启动 | 恢复策略 | 机器配置 |
| --- | --- | --- | --- | --- | --- |
| Windows | Windows Service `GuanlanAgent` | LocalSystem（硬件传感器本就需要 SYSTEM） | `SERVICE_AUTO_START` | `sc failure ... restart/5s/10s/30s` | `%ProgramData%\Guanlan\agent.json`（ACL 仅 SYSTEM + Administrators） |
| Linux | `guanlan-agent.service`（system 级） | 专用系统用户 `guanlan` + `CAP_PERFMON` | `systemctl enable` | `Restart=always` + `StartLimitBurst` | `/etc/guanlan/agent.json`（`root:guanlan 0640`） |

保留 `--parent-pid` 看护逻辑不变——只是**服务模式下不再传该参数**。

### 2.3 配置分层与优先级

| 层 | 位置 | 内容 | 谁写 |
| --- | --- | --- | --- |
| L1 机器级 agent 配置（权威） | Win `%ProgramData%\Guanlan\agent.json`；Linux `/etc/guanlan/agent.json` | 中枢地址、访问密钥、deviceId、hostname、采样、指标、探针、数据记录、云同步、自动重启 | 安装器 / CLI / 引导页 / GUI（提权） |
| L2 机器级服务设置 | 同目录 `service.json` | 监听地址、token 文件路径、spool 上限、日志级别 | 服务自身 |
| L3 用户级桌面偏好 | Electron `userData/desktop-preferences.json` | 开机自启托盘、启动最小化、窗口/主题 | GUI（每用户，与数据面无关） |
| L4 用户级 GUI 会话凭据 | Electron `userData/hub-credential.json` | GUI 登录中枢用的 ACCESS_KEY | GUI |
| L5 一次性覆盖 | 环境变量 / 命令行参数 | 与今天一致（`DSC_SERVER_URL` 等） | 运维/自动化 |

优先级（**与今天采集器的实际语义保持一致，避免行为回归**）：

- **运行时**：L1 机器配置里**非空字段** > 环境变量 > 内置默认。今天的 `mergeConfig` 就是"文件非空字段覆盖 env"（`agents/main.go:1033-1075`），新方案不改这个方向。
- **写入时**：命令行参数不参与运行时优先级，它只作用于 `guanlan-agent config set`，把值**写进 L1 文件**——即"改的是权威层"，因此不需要第五层运行时优先级。
- 环境变量保留为**引导与兼容通道**（对应今天 `install-agent.*` 的 `agent.env`，那条路径没有 JSON 文件，env 就是唯一权威），不作为长期覆盖手段。
- L1 的字段名与今天的 `agent-ui.config.json` 完全兼容（同一 schema），保证无痛迁移。

### 2.4 无 GUI 的四条配置通道

**通道 A：静默安装参数（Windows 一条命令搞定）**

```powershell
# 无人值守安装 + 配置 + 装服务 + 启动 + 校验首次上报
& "DeviceStateConsole-Windows-GUI-Setup-v3.0.18.exe" /S `
    /HUB=https://hub.example.com /KEY=<ACCESS_KEY> `
    /DEVICE=node-01 /HOSTNAME=节点01 /VERIFY=60
```

- `/S` 已由 electron-builder NSIS 提供并在 CI 验证；新增 `/HUB` `/KEY` `/DEVICE` `/HOSTNAME` `/SERVICE=0|1` `/VERIFY=<秒>` 的解析（`customInit`/`customInstall` 中解析 `$CMDLINE`）。
- `/VERIFY` 存在时，安装器等待首次上报确认，失败返回非 0 退出码（供 Intune/SCCM/Ansible 判定），安装日志留在 `%ProgramData%\Guanlan\install.log`。
- 不传 `/HUB` 时保持"装完等人配"的今天行为。

**通道 B：同一个发行体内的小型 CLI（跨平台，替代 `dsc`）**

```bash
guanlan-agent config set --hub https://hub.example.com --key-stdin --device-id node-01   # 密钥走 stdin，不进进程参数
guanlan-agent status --json        # 退出码 0=健康，3=已配置但中枢不可达，4=未配置，5=服务未运行
guanlan-agent doctor --wait 60     # 连接检查 + 探针检测 + 等待首次上报
guanlan-agent service install|uninstall|start|stop|restart|status
guanlan-agent config validate|export|import|push
guanlan-agent probes status|detect
guanlan-agent onboarding-url       # 打印带一次性 token 的本机引导页地址
```

- 命令名与安装路径：`guanlan-agent`（Windows 加 `.exe`），由本地后端二进制承载（重命名/别名方案见 §5 决策 D3）。
- 交互式 TUI **不再保留**（它只是同 API 的另一个前端，删掉不损失能力）。
- 全部支持 `--json`、无需 TTY、非交互默认。

**通道 C：本机回环引导页（有浏览器但没装 GUI 的场景）**

- 服务在 `127.0.0.1:17891/onboarding?token=<一次性 token>` 暴露一个极小的配置页（中枢地址 / 密钥 / 设备名 / "测试连接" / "保存"）。
- 典型用法：`ssh -L 17891:127.0.0.1:17891 user@server`，在本机浏览器打开。
- 与 GUI 复用同一套控制 API，不引入第二套写配置逻辑。

**通道 D：配置文件 / 环境变量（IaC）**

```bash
# Linux 一条命令：装包 + 服务自启 + 配置（postinst 读环境变量）
sudo GUANLAN_HUB=https://hub.example.com GUANLAN_KEY="$KEY" GUANLAN_DEVICE_ID=node-01 \
     apt-get install -y ./DeviceStateConsole-Linux-GUI-Install-v3.0.18.deb
```

- 也支持先装后配：写 `/etc/guanlan/agent.json`（或 `agent.env`）后 `systemctl restart guanlan-agent`。
- Ansible/cloud-init/Intune 均可只用"文件 + 重启"这一条最朴素的路径完成。

### 2.5 自启动、自愈与上报验证

- **自启动**：服务开机自启（不依赖任何登录会话）。
- **自愈**：OS 服务恢复策略（Windows `sc failure` / Linux `Restart=always`）+ 后端对采集器的指数退避重启 + pending spool 断网重放（能力已存在）。
- **可验证**：`guanlan-agent status --json` 输出 `{ service, configured, hubReachable, deviceId, version, lastUploadAt, lastUploadError, pendingSamples }`，退出码见通道 B。
- 这三件事组合起来就是验收："重启机器 → 不登录 → 中枢仍显示在线且时间戳在推进"。

> **必须注意的隐藏开关（否则会出现"装好了但永远不上报"）**
> 后端只有在 `autoStartCollector && dataRecordingEnabled` 同时为真时才启动采集器（`agents/cmd/windows-agent-backend/main.go:366`），而默认配置里 `AutoStartCollector: false`（同文件 `:471`），且**该字段没有"缺字段回填默认值"的兼容逻辑**（对比 `cloudSyncEnabled`/`dataRecordingEnabled`/`autoRestartCollector` 在 `:2194-2200` 都有回填）。
> 也就是说：今天必须有人在 GUI 里点一次"启动采集器"。无 GUI 方案必须显式处理这件事：
> - 服务模式启动时强制 `autoStartCollector = true`（推荐，语义上"服务即代表持续采集"）；
> - 安装器/CLI 写配置时显式写入 `autoStartCollector: true`；
> - 已有旧配置文件的机器，迁移时补写该字段。
> 这一条要写进 Phase 1 的代码改动和 Phase 4 的 CI 断言（断言"重启后无需任何 GUI 操作即恢复上报"）。

### 2.6 GUI 与服务的三种关系

| 场景 | 行为 |
| --- | --- |
| 服务已安装且运行（正常安装） | attach：读状态、显示采集/上报健康度；改机器配置需提权（Windows UAC / Linux `pkexec`），最终仍由服务落盘 |
| 服务未安装（便携版 / 开发） | spawn：完全保持今天的行为（随机端口 + 每运行 token + 自管子进程） |
| 服务存在但停止 | 明确提示"服务未运行"，提供"启动服务"（提权），不静默另起一个进程抢端口 |

安全细节：控制 API 只绑 `127.0.0.1`，token 文件 `0600`（Windows 上 ACL 限 Administrators+SYSTEM）；非提权 GUI 只能读**脱敏**状态，读不到明文密钥；明文密钥只存在于机器级配置与服务内存中。

### 2.7 与 CLI 版的关系：删发行物，不删能力

| 今天的 `dsc` 能力 | 新入口 |
| --- | --- |
| `dsc` / `dsc ui`（TUI 配置界面） | GUI 桌面端 / 回环引导页 |
| `dsc status [--json]` | `guanlan-agent status [--json]` |
| `dsc doctor` | `guanlan-agent doctor --wait` |
| `dsc start` / `stop` / `restart`（采集器） | `guanlan-agent collector start\|stop\|restart` |
| `dsc shutdown`（停本地 backend） | `guanlan-agent service stop` |
| `dsc probes status\|detect` | `guanlan-agent probes status\|detect` |
| `dsc config get\|set\|validate\|export\|import\|push` | `guanlan-agent config ...`（同语义、同脱敏、同 `--secret-stdin`） |
| `dsc version` | `guanlan-agent version` |
| `device-state-console-agent update`（自更新，见 `agents/update.go`） | 保留；但需同步改写它硬编码的服务名（见 Phase 1 第 6 条） |
| `install-agent.sh --server-url --secret` | deb `postinst` + 环境变量 / `guanlan-agent config set` |
| `install-agent.ps1`（SYSTEM 计划任务） | 安装器注册 Windows 服务 |
| CLI zip（`update-agents-test.yml` 的传输载体） | Linux `.deb`（`dpkg-deb -x` 或 `dpkg -i`），Windows 用 `Update.zip` |

### 2.8 变更后的发行资产

| 资产 | 变化 |
| --- | --- |
| `DeviceStateConsole-Windows-GUI-Setup-vX.Y.Z.exe` | 保留；新增静默参数、服务注册、机器级配置写入 |
| `DeviceStateConsole-Windows-GUI-Portable-vX.Y.Z.zip` | 保留（便携模式 = spawn 模式） |
| `DeviceStateConsole-Windows-GUI-Update-vX.Y.Z.zip` | 保留 |
| `DeviceStateConsole-Linux-GUI-Install-vX.Y.Z.deb` | 保留；新增 systemd unit + postinst/prerm、`/usr/bin/guanlan-agent` |
| `DeviceStateConsole-Android-vX.Y.Z.apk` | 不变 |
| `DeviceStateConsole-*-CLI-Install-*.zip`、`install-cli.sh/.ps1` | **下架** |

需同步改写 `AGENTS.md`（资产命名规则）、`RELEASE.md`（§Release Asset Names、§User Installation Sources）、`README.md`（下载/安装/设备采集章节）。

---

## 3. 实施计划

> 遵循仓库规则：本机不做任何构建/打包，全部落在 `.github/workflows/`；版本号只递增 patch（`3.0.17 → 3.0.18`），并同步 `VERSION` 与所有 manifest。

### Phase 0：决策与文档（无代码风险）

- 确认 §5 的决策点。
- 更新 `docs/unified-desktop/architecture.md`（"not a service" / "no systemd unit" 两句需要改写）、`process-lifecycle.md`、`migration-plan.md`。
- 产出 `docs/HEADLESS_AGENT.md`（用户可见的无人值守安装手册：四条通道 + 退出码 + 故障排查）。

### Phase 1：Go 侧服务化与 CLI（核心）

改动清单：

1. 新增 `agents/internal/agentconfig/`：配置 schema、默认值、机器级路径解析、ACL/权限设置、原子读写、脱敏。替换今天 4 份重复 schema（`agents/main.go`、`agents/cmd/dsc/main.go`、`agents/cmd/windows-agent-backend/main.go` 改为引用它）。
2. 新增 `agents/internal/agentservice/`：
   - Windows：`x/sys/windows/svc` 实现原生服务宿主（`--service-run` 由 SCM 调用）+ `install/uninstall/start/stop` 子命令（`sc.exe` 或 `CreateService`）。
   - Linux：生成/校验 systemd unit 与 `tmpfiles.d`，`install/uninstall/enable/disable` 子命令。
3. `agents/cmd/windows-agent-backend`：
   - 新增 `--service-mode`（不要求 `--parent-pid`，config-root 默认机器级路径）。
   - 新增 CLI 子命令组：`config`、`status`、`doctor`、`service`、`probes`、`onboarding-url`、`version`（把 `dsc` 的能力平移过来）。
   - 新增只读脱敏状态接口与引导页路由；控制接口沿用现有 `/api/*` + token。
   - 固定回环端口（`127.0.0.1:17891`），token 文件落到机器级目录并收紧权限。
4. 采集器 `agents/main.go`：无需功能改动，仅随 `agentconfig` 抽包调整；确认服务账户下硬件探针路径（SYSTEM 反而更完整）。
5. `agents/update.go`：自更新流程里**硬编码了服务名**（`systemctl stop/start device-state-console-agent.service`、`systemctl --user ... device-state-console-agent-backend.service`、`schtasks /End|/Run DeviceStateConsoleAgent`），必须同步支持新服务名 `guanlan-agent`，否则更新会停不掉/起不来服务。
6. 单元测试：`agents/internal/agentconfig`、`agentservice`（路径/优先级/幂等/无 TTY）、backend 子命令解析。

验收（CI，Phase 4 落地）：Linux runner 上 `dpkg-deb -x` 后直接跑 `guanlan-agent config set` + `status --json`；Windows runner 上 `sc create` + `sc start` + `status --json`。

### Phase 2：Electron 改为 attach-or-spawn

改动清单：

1. `apps/desktop/src/main/agent-manager.ts`：新增 `attach()`（探测固定端点 + 读取机器 token），`start()` 变为 `attach() ?? spawn()`；状态里增加 `managed: "service" | "child"`。
2. `apps/desktop/src/main/controller.ts`：快照增加"本机服务"状态；写机器配置改为调用提权 CLI（Windows UAC via `runas`/`powershell Start-Process -Verb RunAs`；Linux `pkexec guanlan-agent config set ...`），失败时给出可复制的命令。
3. `apps/desktop/src/main/types.ts`、`packages/shared/src/index.ts`：增量字段（向后兼容）。
4. 渲染层：设置页区分"本机 Agent 服务（系统级）"与"桌面端偏好（当前用户）"；服务未运行时给出明确状态而不是伪装在线。
5. `docs/unified-desktop/*` 同步。

验收：CI 现有 Electron 视觉/启动验收继续通过；新增"服务已运行时 GUI attach 成功（不再 spawn 第二个进程）"的断言。

### Phase 3：安装器与服务注册

Windows（`apps/desktop/build/installer.nsh`）：

- `customInstall`：解析 `$CMDLINE` 的 `/HUB` `/KEY` `/DEVICE` `/HOSTNAME` `/SERVICE` `/VERIFY`；`sc.exe create GuanlanAgent binPath= "<安装目录>\resources\agent\device-state-console-agent-backend.exe" --service-mode --config-root "C:\ProgramData\Guanlan"`；`sc failure` 设恢复；`sc start`；`/HUB` 存在时写入机器级 `agent.json`（ACL 收紧）。
- `customUnInstall`：`sc stop` + `sc delete`；默认**保留**配置，`/REMOVECONFIG` 才删。
- 保留 PawnIO 与 `install-hardware-helper` 逻辑不变。
- 同步更新 `scripts/verify-windows-installer-config.mjs`（含对 `release-test.yml` 步骤标题的逐字断言）。

Linux（`apps/desktop/package.json` 的 `build.linux` / electron-builder deb）：

- 新增 `afterInstall`/`afterRemove` 模板：安装 `guanlan-agent.service`（system 级）、创建 `guanlan` 用户与 `/etc/guanlan`、`systemctl daemon-reload && systemctl enable --now guanlan-agent`；卸载时 `disable --now` 并保留配置。
- 新增 `/usr/bin/guanlan-agent` 入口（指向包内后端二进制的包装脚本或符号链接）。
- `afterInstall` 支持读取 `GUANLAN_HUB/KEY/DEVICE_ID` 环境变量完成无人值守配置。
- **必须显式修正当前的 deb 命名缺陷**（从 electron-builder 26.15.3 源码静态推导，未经真实产物验证）：因为 `apps/desktop/package.json` 的 `name` 是 `@dsc/desktop`、`productName` 是 `观澜` 且没有 `deb` 配置块，发货的 deb 实际是
  `Package: 观澜`、安装前缀 `/opt/观澜/`、可执行名 `@dscdesktop`、`/usr/bin/@dscdesktop`、desktop 文件 `@dscdesktop.desktop`。
  这在无人值守/企业分发场景是不可接受的。Phase 3 需显式设置
  `linux.executableName: "guanlan"`、`deb.packageName: "guanlan-desktop"`、`linux.desktop.Name`，并显式声明 `deb.depends`（默认值 `libgtk-3-0, libnotify4, libnss3, libxss1, libxtst6, xdg-utils, libatspi2.0-0, libuuid1, libsecret-1-0`）与 `deb.afterInstall`。
- 评估 `Depends` 体积：headless 服务器会被拉入 Electron 的 GTK/X11 依赖（可安装但体积大）。按 D4 保持单包（符合"只保留 GUI 版"）。

验收：Phase 4 的 CI job 覆盖。

### Phase 4：CI 无 GUI 验收（新增 job）

在 `release-test.yml`（或 `ci.yml`）新增两个 job：

- **`headless-linux`**（`ubuntu-24.04`，无桌面会话）：
  1. `dpkg -i` 生成的 deb（含依赖）
  2. 断言 `systemctl is-enabled/is-active guanlan-agent` 成功
  3. 起一个**桩中枢**（Node 脚本监听本地端口，只断言收到 `POST /api/agent/ingest` 且 Bearer 正确）
  4. `GUANLAN_HUB/KEY` 配置后断言 90 秒内收到上报
  5. `systemctl restart` 后断言继续上报（自愈）
  6. `guanlan-agent status --json` 退出码 0
  7. 卸载断言服务被移除、配置保留
- **`headless-windows`**（`windows-2022`）：
  1. `setup.exe /S /HUB=... /KEY=... /DEVICE=... /VERIFY=60` 断言退出码 0
  2. `Get-Service GuanlanAgent` 为 `Running`，`StartType=Automatic`
  3. 桩中枢断言收到上报
  4. 杀进程后断言服务自动拉起（自愈）
  5. `guanlan-agent status --json` 退出码 0
  6. 静默卸载断言服务已删除

同时改造 `update-agents-test.yml`：传输载体由 CLI zip 改为 Linux `.deb`（`dpkg-deb -x` 取二进制或直接 `dpkg -i`）。

### Phase 5：下架 CLI 发行版

- 删除：`agents/cmd/dsc/`、`deploy/install-cli.{sh,ps1}`、`deploy/build-cli-agent.ps1`、`deploy/install-agent-from-release.*`（或改写为 deb 引导）、`release-test.yml` 的 CLI 构建/校验/上传步骤、release 发布 job 的 CLI 资产计数断言（`release-test.yml:476-492` 共 20 行 `test ... -eq 1`）。
- **中枢侧（易漏）**：`apps/server/src/routes.ts:242-252` 的 `updateQuerySchema` 枚举、`apps/server/src/updates.ts:183-198` 的 `assetNameFor`/`installModeFor`、`packages/shared/src/index.ts` 的 `UpdatePlatform`(`windows-cli`/`linux-cli`) 与 `installMode`(`cli`) 必须同步移除，否则 `/api/updates` 会返回已不存在的资产名。
- **不要删**：`agents/update.go`（采集器自更新，服务形态唯一升级通道，只改服务名与平台枚举）。
- `release-test.yml:463-474` 的 `.sha256` 自动生成只覆盖 `*.exe|*.zip|*.deb|*.apk|*.ps1|*.sh`；若引入新扩展名必须同时扩展该列表，否则违反 `RELEASE.md:133`。
- 清理：`linux-agent-gui/`（GTK 已不在发布路径）、`deploy/build-windows-agent-setup.ps1` + `windows-agent-setup.iss`（Inno 已死）、`ci.yml:122` 的 GTK 构建步骤、`deploy/publish-github-release.ps1`（非 prerelease + `--clobber` 的发布地雷）。
- 文档：`README.md`、`RELEASE.md`、`AGENTS.md`、`agents/README.md`（它把 CLI 描述为 "the portable/headless option"，必须改写为新方案）。

### Phase 6：版本、发布与本机验证（按 AGENTS.md 固定流程）

1. `VERSION` 与所有 manifest 同步递增到 `3.0.18`。
2. 本机只允许静态检查：`node scripts/verify-version.mjs`、`node scripts/verify-windows-installer-config.mjs` 等。
3. 提交并推送 `main` → 打 tag `v3.0.18` → 等待 verify/build/publish 全部完成。
4. 核对 Release 与 Windows GUI setup 资产。
5. 在本机完成静默安装并确认安装成功：通过 `ssh 27h2-vm`（Windows 11 Pro Insider，SSH 会话已提权为管理员）执行
   `Start-Process setup.exe -ArgumentList "/S","/HUB=...","/KEY=...","/DEVICE=..." -Wait -PassThru` → 断言退出码 0
   → `Get-Service GuanlanAgent` 为 `Running`/`Automatic` → 桩中枢确认收到 `POST /api/agent/ingest`
   → `guanlan-agent status --json` 退出码 0 → 静默卸载并断言服务已删除。
   虚拟机未开机时先经 `pve1`/`pve3` 启动。
6. 全部通过后才可宣称完成；任何一环失败都必须继续排查或明确报告阻塞。

---

## 4. 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| Windows 服务运行在 SYSTEM 下，硬件传感器/驱动行为变化 | 采集数据可能与今天不同 | 服务账户用 LocalSystem（本就需要 SYSTEM 读 CPU 包温度）；保留 `install-hardware-helper` 计划任务与 PawnIO 逻辑；Phase 4 增加硬件字段非空断言 |
| GUI 与服务双写配置 | 配置互相覆盖 | 服务是唯一写者；GUI 写配置必须走提权 CLI/API；文件用原子写 + 版本号防并发 |
| **现有配置根路径本身不确定** | 迁移可能找不到老配置 | `apps/desktop/package.json` 没有顶层 `productName`，`app.getName()` 可能返回 `@dsc/desktop`（而不是 `观澜`），即 userData 可能是 `%APPDATA%\@dsc\desktop`。Electron 倾向优先 `productName`，因此两种结果都可能。**Phase 3 安装后立即在 `27h2-vm` 上实测并记录真实路径**，再定迁移源列表（`controller.ts:56-61` 的 4 条旧路径继续保留） |
| 固定端口 17891 被占用 | 服务起不来 | 启动失败时明确报错并回退到随机端口写回 `service.json`；GUI attach 时先读 `service.json` 再探测 |
| 机器级密钥的权限 | 本机其他用户可读 | Windows ACL 限 SYSTEM+Administrators；Linux `0640 root:guanlan`；非提权只暴露脱敏状态接口 |
| Linux 单包依赖 Electron 的 GTK/X11 库 | headless 安装体积大 | 默认单包可接受；若要求极简则按 D4 拆包 |
| `verify-windows-installer-config.mjs` 的逐字断言 | 安装器一改 CI 就红 | Phase 3 同步更新该脚本与其断言的步骤标题 |
| `update-agents-test.yml` 依赖 CLI zip | 删 CLI 会打断批量更新 | Phase 5 同步改造为基于 deb；注意该 workflow 现在**自带内联的 stop/替换/start 脚本**，并不调用 `install-agent.sh`，两条链路都要改 |
| **中枢侧也耦合了 CLI 平台** | 客户端自更新会 404 或拿到不存在的资产名 | `apps/server/src/routes.ts:242-252`（`updateQuerySchema` 枚举）与 `apps/server/src/updates.ts:183-198`（`assetNameFor`/`installModeFor`）硬编码 `windows-cli`/`linux-cli` → CLI zip；必须与 `packages/shared` 的 `UpdatePlatform`/`installMode` 联合类型一起改，**这是 Phase 5 的必改项，漏了会静默坏掉更新通道** |
| **`agents/update.go` 被误删** | 存量 `install-agent.*` 机器失去唯一升级通道 | 该文件编译进**采集器**，是服务形态下唯一自更新实现（`/api/updates` + SHA-256 + Linux `is-active` 回滚 / Windows 计划任务重启）。**只允许改（服务名/平台枚举），不允许删** |
| `install-agent.ps1` 不部署硬件探针 DLL | Windows 服务形态可能缺 `HardwareSensorProbe.dll` | 新安装器必须统一部署 `windows-hardware/` + `hardware-sensor-probe/`（Phase 4 断言这两条路径存在） |
| Windows 上 `agent.env`/`run-agent.ps1` 明文密钥且无 ACL 收紧 | 本机任意用户可读密钥 | 机器级配置 ACL 仅 SYSTEM+Administrators；新实现不再生成含明文密钥的 `run-agent.ps1` |
| `deploy/publish-github-release.ps1` 是发布安全地雷 | 手工执行会创建**非 prerelease** Release 并 `--clobber`，可能移动 GitHub "Latest" 徽标，违反 AGENTS.md | 无 workflow 引用它，仅 `README.md:142` 链接；Phase 5 一并删除或加保护（需你确认是否保留其职能） |
| 老 CLI 用户升级路径 | 存量机器失管 | 保留采集器 env 契约与旧配置路径只读迁移；提供 `dsc → guanlan-agent` 命令对照表；`install-agent-from-release.*` 改写为 deb 引导 |
| AGENTS.md 资产规则与新方案冲突 | 规则自相矛盾 | Phase 0 先改规则再改代码（决策 D7） |

---

## 5. 决策记录

| # | 决策 | 结论 | 对实现的影响 |
| --- | --- | --- | --- |
| D1 | Windows 自启动形态 | ✅ **服务优先 + 计划任务兜底** | 实现 `agentservice` 时同时提供两条注册路径：默认 `sc.exe create`（原生服务）；服务创建/启动失败（受限 SKU、组策略禁用服务、非管理员安装）时自动回退到 `AtStartup`+SYSTEM 计划任务，并在 `status --json` 里标明当前形态（`service` / `scheduled-task`）。**兜底路径不得退化为 HKCU Run**（今天 `deploy/install-agent.ps1:146-153,167-171` 会静默写入 HKCU Run，那是登录级、非 headless，新实现必须禁止这种降级并明确报错/记录）。 |
| D2 | 是否额外提供 MSI | ⏸ 暂不做（先 NSIS `/S`） | 后续如需企业静默分发再加 WiX/MSI。注意 NSIS `perMachine: true` ⇒ 安装器 `RequestExecutionLevel admin`，静默安装**必须已提权**。 |
| D3 | 命令/二进制命名 | ✅ 采用 `guanlan-agent`，保留旧名兼容副本一个补丁周期 | 影响 `deploy/*` 构建脚本、`agent-manager.ts` 的 `resolveBackendBinary`、CI 冒烟测试、`installer.nsh` 的 taskkill 列表、`agents/update.go` 的服务名。 |
| D4 | Linux 打包 | ✅ **单个 deb（GUI + 服务）** | `deb.afterInstall` 里启动 system 级服务；同时**必须显式设置 `linux.executableName` 与 `deb.packageName`**（见 §7.1 的现状缺陷）。 |
| D5 | 是否保留交互式 TUI | ✅ 删除 | 删 `agents/cmd/dsc/`。 |
| D6 | 回环引导页是否本期做 | ⏸ 下个补丁再做（本期先打通安装参数 + CLI） | 控制 API 设计需预留该路由，避免二期返工。 |
| D7 | 改写 `AGENTS.md`/`RELEASE.md` 资产规则 | ✅ **已授权** | Phase 0 先改规则，再改代码。 |
| D8 | 本机静默安装验证方式 | ✅ **用 `ssh 27h2-vm`（Windows 11 Pro Insider，build 10.0.29639.1000，主机名 `DESKTOP-F0OMO4H`，用户 `lvziw`，SSH 会话已是**提权管理员**；2026-09 核查时该机**尚未安装本应用**，是干净目标）** | Phase 6 可在该 VM 上真实执行静默安装/重装/卸载与 `Get-Service`、`status --json` 断言；虚拟机未开机时先经 `pve1`/`pve3` 启动。**注意该主机此前不在 `known_hosts` 中，本次首次连接已按 TOFU 记录 ED25519 主机键。** |

---

## 6. 影响面清单（供实施时逐项勾选）

- Go：`agents/main.go`、`agents/cmd/windows-agent-backend/main.go`、新增 `agents/internal/{agentconfig,agentservice}`、`agents/update.go`（**改服务名与平台枚举，不删除**）、（删除）`agents/cmd/dsc/`
- 中枢：`apps/server/src/routes.ts`（update 平台枚举）、`apps/server/src/updates.ts`（`assetNameFor`/`installModeFor`）、`packages/shared/src/index.ts`（`UpdatePlatform`/`installMode`/快照增量字段）
- Electron：`apps/desktop/src/main/{agent-manager,controller,types,ipc,main}.ts`、`apps/desktop/build/installer.nsh`、`apps/desktop/package.json`
- 安装/发布：`.github/workflows/{ci,release-test,update-agents-test}.yml`、`scripts/verify-windows-installer-config.mjs`（34 条断言；只绑定 GUI 安装器与 GUI 步骤标题，删 CLI 步骤不会触发它）、`scripts/verify-version.mjs`（如需）
- 文档：`README.md`、`RELEASE.md`、`AGENTS.md`、`agents/README.md`、`docs/unified-desktop/*`、新增 `docs/HEADLESS_AGENT.md`
- 版本：`VERSION`、6 个受 `verify-version.mjs` 强制的 manifest（根 + `apps/{server,web,desktop}` + `packages/{shared,console-ui}`）
