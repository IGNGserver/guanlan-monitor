# 设备状态控制台

面向局域网设备的状态监控系统，包含 Web 控制台、中枢服务，以及可部署在 Linux / Windows 设备上的 agent。

## 项目结构

- `apps/server`：Fastify + Socket.IO 中枢服务，负责鉴权、设备状态、历史聚合与 agent 接入
- `apps/web`：Next.js Web 控制台
- `packages/shared`：前后端共享类型
- `agents`：采集端 agent
- `deploy`：systemd、Docker 等部署示例

## 当前能力

- 设备在线/离线状态与实时推送
- 1 分钟、15 分钟、1 天、1 周、1 月、1 年多时间窗口视图
- CPU、内存、交换分区、磁盘、网络流量等核心指标
- 历史小时级聚合与保留
- Agent 5 秒上报
- 基于访问密钥的 Web 登录

## 环境要求

### 生产部署

- Docker Engine 24+
- Docker Compose v2

### 本地开发

- Node.js `22+`
- `pnpm 10+`
- Go `1.24+`

## 快速部署

### 1. 准备配置

```bash
cp .env.example .env
```

必须修改这些值：

- `SESSION_SECRET`
- `ACCESS_KEY`
- `MYSQL_ROOT_PASSWORD`
- `MYSQL_PASSWORD`
- `AGENT_SHARED_SECRET`

如果你通过 HTTPS 对外提供服务，改成：

```env
SESSION_COOKIE_SECURE=true
```

### 2. 启动服务

默认方案：

```bash
docker compose up -d --build
```

如果你的网络访问 Docker Hub 不稳定，优先尝试国内镜像方案：

```bash
docker compose -f docker-compose.yml -f docker-compose.cn.yml up -d --build
```

默认端口：

- Web：`3000`
- Server API / Socket.IO：`4000`
- Redis：`6379`
- MySQL：`3306`

如果这些端口已被本机其他服务占用，可以直接修改 `.env` 中的 `WEB_PORT`、`SERVER_PORT`、`REDIS_PORT`、`MYSQL_PORT` 后重新执行 `docker compose up -d --build`。

### 3. 登录

访问：

- `http://你的主机IP:3000`

登录密钥：

- `.env` 中的 `ACCESS_KEY`

登录页面只需要输入访问密钥，不需要用户名和密码。

## 如何使用

### 1. 登录控制台

打开 `http://你的主机IP:3000`，输入 `.env` 中配置的 `ACCESS_KEY`。

### 2. 接入第一台设备

在你要监控的设备上部署一个 agent：

- Linux 设备：执行下方的 Linux 一键部署脚本
- Windows 设备：执行下方的 Windows 一键部署脚本

部署成功后，设备会自动出现在控制台首页。

### 3. 查看设备状态

控制台首页会显示：

- 在线 / 离线状态
- 最近上报时间
- CPU、内存、磁盘等摘要指标

点击设备卡片后可以进入详情页，查看更完整的实时指标和历史曲线。

### 4. 查看历史趋势

每台设备都支持这些时间窗口：

- `1m`
- `15m`
- `1d`
- `1w`
- `1mo`
- `1y`

可以用来查看短时波动、日常负载变化，以及更长周期的资源趋势。

### 5. 查看网络流量和硬件指标

如果 agent 所在设备支持采集，你还可以看到：

- 网络收发速率和累计流量
- CPU 频率与温度
- GPU 占用、频率、显存
- 磁盘读写速率

不同设备能看到的指标会有差异，这取决于操作系统、驱动和硬件是否提供这些数据。

### 4. 如果首次安装卡在拉取镜像

如果你看到 `mysql:8.4` 或 `redis:7.4-alpine` 拉取超时，通常不是项目配置错误，而是当前网络无法稳定访问 Docker Hub。

可以按这个顺序排查：

1. 先单独测试镜像拉取

```bash
docker pull mysql:8.4
docker pull redis:7.4-alpine
```

2. 如果拉取失败，改用仓库内提供的国内镜像方案

```bash
docker compose -f docker-compose.yml -f docker-compose.cn.yml up -d --build
```

3. 如果仍然失败，再考虑为 Docker 配置镜像加速器或代理

如果你已经成功拉到镜像，后续再次安装通常会顺利很多。

## Agent 一键部署

Agent 所在设备需要先安装 `Node.js 22+`。

## 推荐部署模型

默认推荐把 agent 安装到固定目录，并通过“守护脚本 + 系统启动器”运行，而不是直接把 `node node-agent.mjs` 写成一次性启动命令。

- Windows 首选：`C:\ProgramData\DeviceStateConsoleAgent` + `DeviceStateConsoleAgent` 计划任务
- Linux 首选：`/opt/device-state-console-agent` + `device-state-console-agent.service`
- 两个平台都会生成单独的守护脚本：
  - Windows：`run-agent.ps1`
  - Linux：`run-agent.sh`
- 守护脚本都具备两层保护：
  - 进程异常退出后自动重启
  - 在限定时间窗口内连续崩溃超过阈值后停止重启并写日志，避免无限重启风暴

如果 Windows 因权限原因无法注册 `SYSTEM` 计划任务，安装脚本会自动降级到“当前用户自启”模式；该降级分支仍然使用同一套守护循环和连续崩溃保护逻辑，只是启动来源从计划任务改成当前用户登录后的自启。

### Linux

在项目目录中执行：

```bash
sudo bash deploy/install-agent.sh \
  --server-url http://你的中枢IP:4000 \
  --secret 你的agent密钥 \
  --device-id node-001
```

参数说明：

- `--server-url`：中枢服务地址，通常是运行 `server` 的机器地址和端口，例如 `http://192.168.1.10:4000`。
- `--secret`：agent 上报密钥，必须和服务端 `.env` 中的 `AGENT_SHARED_SECRET` 完全一致。
- `--device-id`：设备唯一 ID，会显示在控制台中。建议使用稳定、可读的名称，例如 `nas-01`、`office-pc`。如果不传，默认使用当前主机名。
- `--hostname`：可选，设备展示名。适合 `deviceId` 用英文稳定标识、界面展示名用中文或更友好的场景。
- `--install-dir`：可选，agent 安装目录，默认 `/opt/device-state-console-agent`。
- `--service-user`：可选，运行 systemd 服务的系统用户，默认 `dsc-agent`。
- `--node-path`：可选，显式指定 `node` 路径。适用于系统里有多个 Node，或你要绑定便携版 Node。
- `--restart-count`：可选，重启窗口内允许的最大重启次数，默认 `10`。
- `--restart-window-minutes`：可选，连续崩溃统计窗口，默认 `5` 分钟。

脚本会自动：

- 复制 agent 到 `/opt/device-state-console-agent`
- 写入 `agent.env`
- 生成 `run-agent.sh`
- 创建 `dsc-agent` 系统用户
- 注册并启动 `device-state-console-agent.service`

Linux 默认使用系统级 `systemd` 服务，而不是依赖登录会话的 `systemd --user`。这样即使设备没有用户登录，agent 也会在开机后自动在线。

`run-agent.sh` 内部会负责：

- 从 `agent.env` 加载环境变量
- 异常退出后延时重启
- 在默认 `5` 分钟内连续崩溃超过 `10` 次时停止重启，并把原因写入 `agent.err.log`

日志文件默认位于安装目录：

- `agent.out.log`
- `agent.err.log`

查看状态：

```bash
systemctl status device-state-console-agent.service
```

### Windows

在 PowerShell 管理员窗口中执行：

```powershell
powershell -ExecutionPolicy Bypass -File deploy\install-agent.ps1 `
  -ServerUrl "http://你的中枢IP:4000" `
  -Secret "你的agent密钥" `
  -DeviceId "node-001"
```

参数说明：

- `-ServerUrl`：中枢服务地址，通常是运行 `server` 的机器地址和端口，例如 `http://192.168.1.10:4000`。
- `-Secret`：agent 上报密钥，必须和服务端 `.env` 中的 `AGENT_SHARED_SECRET` 完全一致。
- `-DeviceId`：设备唯一 ID，会显示在控制台中。建议使用稳定、可读的名称，例如 `gaming-pc`、`office-laptop`。如果不传，默认使用当前计算机名。
- `-HardwareJsonUrl`：可选，LibreHardwareMonitor / OpenHardwareMonitor 的远程 Web JSON 地址，例如 `http://127.0.0.1:8085/data.json`。通常不需要，agent 已内置 Windows 硬件库。
- `-RedfishUrl`：可选，服务器 BMC / Redfish 根地址，例如 `https://192.168.1.100`。配置后 agent 会额外尝试从 Redfish 读取 CPU 温度和风扇。
- `-RedfishUsername` / `-RedfishPassword`：可选，Redfish 登录凭据。
- `-RedfishInsecure`：可选，允许忽略 Redfish HTTPS 证书问题。默认关闭。
- `-EnablePawnIo`：可选，尝试安装 PawnIO 低层硬件访问驱动，用于增强部分机器上的 CPU 温度/风扇探测。默认不安装。
- `-AllowAcpiThermalZone`：可选，允许回退读取 Windows `MSAcpi_ThermalZoneTemperature`。该值通常不是 CPU Package/Core 温度，默认禁用。
- `-InstallDir`：可选，agent 安装目录，默认 `C:\ProgramData\DeviceStateConsoleAgent`。
- `-NodePath`：可选，显式指定 `node.exe` 路径。适用于 Node 不在 `PATH`，或者你使用便携版 Node 的机器。
- `-RestartCount`：可选，计划任务在 `-RestartIntervalMinutes` 时间窗口内的最大重启次数，默认 `10`。
- `-RestartIntervalMinutes`：可选，计划任务的重试时间窗口，默认 `5` 分钟。
- `-PreferCurrentUserAutostart`：可选，显式使用当前用户自启，而不是优先注册 `SYSTEM` 计划任务。

脚本会把 agent、内置 Windows 硬件库和 `PawnIO` 安装器安装到 `C:\ProgramData\DeviceStateConsoleAgent`，生成守护版 `run-agent.ps1`，并优先注册为开机启动的计划任务。默认不会安装 `PawnIO` 驱动；只有显式传入 `-EnablePawnIo` 时，才会尝试静默安装底层驱动。

如果计划任务注册失败，脚本会自动降级到当前用户自启，但不会退回到旧的一次性启动模型。无论计划任务模式还是当前用户自启模式，都会保留：

- 守护循环
- 自动重启
- 连续崩溃阈值退出
- `agent.out.log` / `agent.err.log` 日志

Windows agent 会优先使用随包分发的 LibreHardwareMonitor 库读取 CPU 温度、风扇、GPU 温度/频率等传感器；如果系统中已经运行 LibreHardwareMonitor / OpenHardwareMonitor，也会自动兼容它们暴露的 WMI / Web 数据源。对服务器设备，还可以额外启用 Redfish / BMC 作为 CPU 温度和风扇的补充来源。如果机器本身或驱动没有提供可读传感器，相关字段仍会显示为空值，而不是退化成误导性的 ACPI 热区温度。

查看任务：

```powershell
Get-ScheduledTask -TaskName "DeviceStateConsoleAgent"
```

## Agent 手动部署

### Go Agent

```bash
cd agents
DSC_SERVER_URL=http://你的中枢IP:4000 \
DSC_AGENT_SECRET=你的agent密钥 \
DSC_DEVICE_ID=node-001 \
go run .
```

Windows PowerShell 示例：

```powershell
$env:DSC_SERVER_URL="http://你的中枢IP:4000"
$env:DSC_AGENT_SECRET="你的agent密钥"
$env:DSC_DEVICE_ID="node-001"
go run .
```

### Node Agent

Node Agent 同样需要 `Node.js 22+`。

Linux / macOS 示例：

```bash
cd agents
DSC_SERVER_URL=http://你的中枢IP:4000 \
DSC_AGENT_SECRET=你的agent密钥 \
DSC_DEVICE_ID=node-001 \
node node-agent.mjs
```

Windows PowerShell 示例：

```powershell
$env:DSC_SERVER_URL="http://你的中枢IP:4000"
$env:DSC_AGENT_SECRET="你的agent密钥"
$env:DSC_DEVICE_ID="node-001"
node .\node-agent.mjs
```

环境变量示例见 [deploy/agent.env.example](deploy/agent.env.example)。

systemd 示例文件位于：

- [deploy/device-state-console-agent.service](deploy/device-state-console-agent.service)
- [agents/dev-machine-agent.service](agents/dev-machine-agent.service)

如果你要在仓库工作区里直接把开发机 agent 作为用户服务运行，不要把真实密钥写进 `*.service` 文件。
可复制一份本地私有配置：

```bash
cp agents/dev-machine-agent.env.example agents/dev-machine-agent.env
```

然后把 `agents/dev-machine-agent.env` 改成你的真实值。这个文件已被 `.gitignore` 排除，不会进入 Git。

如果你沿用仓库里的 `agents/dev-machine-agent.service` 示例，也建议搭配一个本地私有的 `agents/run-dev-machine-agent.sh` 守护脚本，而不是把 `node-agent.mjs` 直接写进 `ExecStart`。

## 本地开发

### 1. 安装依赖

```bash
cp .env.example .env
pnpm install
cd agents && go mod tidy
```

开发环境建议把下面两个地址改成适合本机的值：

```env
REDIS_URL=redis://127.0.0.1:6379
MYSQL_URL=mysql://dsc:你的密码@127.0.0.1:3306/device_state_console
NEXT_PUBLIC_SERVER_URL=http://127.0.0.1:4000
```

### 2. 启动依赖

```bash
docker compose up -d redis mysql
```

### 3. 启动前后端

```bash
pnpm dev
```

### 4. 开发校验

```bash
pnpm typecheck
pnpm build
```

## Android 发布

安卓客户端当前应用名为 `观澜`。

当前准备发布的版本为 `v0.1.2`。

当前版本默认支持连接局域网中的 `http://` 中枢地址，适合未启用 HTTPS 的内网部署环境。

这次版本包含的重点更新：

- 总览页改为按类别展示胶囊指标，点击后进入带分页和滑动动画的半屏详情
- 显卡显存、磁盘容量等指标支持同时显示当前值与总上限，不再只显示百分比
- `15m / 1d` 视图中的网速与磁盘速率保持按时间窗口平均值聚合
- Windows / Linux agent 默认统一为守护脚本 + 自动重启 + 连续崩溃阈值退出
- Linux 设备新增更完整的 CPU 包级频率、磁盘、网络接口和 `sensorBackends` 回传
- Windows PowerShell 输出统一为 UTF-8，修复中文网卡名乱码问题

### 本地构建 release 包

```bash
./android/gradlew -p android assembleRelease
```

如果没有提供正式签名材料，输出会是未签名 APK：

- `android/app/build/outputs/apk/release/app-release-unsigned.apk`

### 配置正式签名

在构建前设置这些环境变量，或等价地写入 Gradle 属性：

```bash
export DSC_UPLOAD_STORE_FILE=/path/to/your-keystore.jks
export DSC_UPLOAD_STORE_PASSWORD=your-store-password
export DSC_UPLOAD_KEY_ALIAS=your-key-alias
export DSC_UPLOAD_KEY_PASSWORD=your-key-password
```

签名文件建议放在项目内但不纳入 Git 的目录：

```text
android/signing/
```

详细说明见 [deploy/android-release.md](deploy/android-release.md)。

如果你本地保留了未提交的签名变量文件，也可以在构建前先加载它，再执行正式打包：

```bash
source android/signing/release-credentials.env
./android/gradlew -p android clean assembleRelease
```

然后重新构建：

```bash
./android/gradlew -p android assembleRelease
```

配置完整后，release 构建会自动使用你的签名配置。

推荐把最终产物命名为：

- `guanlan-android-v0.1.2.apk`

## 生产部署说明

- `docker-compose.yml` 面向单机部署，包含 Redis 和 MySQL。
- MySQL 表会由服务端自动初始化。
- Redis 与 MySQL 都挂载命名卷，容器重建不会直接丢数据。
- 如果要公网暴露，建议前面加 Nginx / Caddy，并只开放 Web 入口。

## 常见问题

### Agent 掉线时先查什么

建议按这个顺序排查：

1. `DSC_SERVER_URL` 是否写对，agent 必须上报到 Server API 端口，例如 `http://192.0.2.28:4000`，不能写成 Web 端口。
2. Windows 是否真的注册并启动了 `DeviceStateConsoleAgent` 计划任务；如果权限不足，是否至少成功落到了当前用户自启分支。
3. 启动入口是否是守护脚本：
   - Windows：`run-agent.ps1`
   - Linux：`run-agent.sh`
4. 是否只是某个采集源缺失。正常情况下，单项硬件探测失败不应导致整机掉线，agent 应继续上报其他可用数据。

### 为什么有些字段为空

这是预期行为，不一定表示 agent 异常。常见原因包括：

- CPU 温度：主板、驱动或虚拟机没有提供可读传感器
- GPU 频率 / 温度 / 显存：驱动或对应工具链不可用，例如 Linux 上没有可读 sysfs 或没有 `nvidia-smi`
- 风扇：很多普通台式机和虚拟机不会暴露标准风扇接口
- 网卡、磁盘分项：系统权限或底层统计接口缺失

当前默认策略是“尽量多采，缺什么就留空”，而不是把不支持的字段硬填成 `0`，也不会因为单项探测失败而阻断 agent 上线。

### Linux 和 Windows 的默认守护行为是什么

两边默认都包含：

- 异常退出自动重启
- 连续快速崩溃时触发阈值退出
- 输出日志到安装目录

默认窗口为 `5` 分钟，默认最大重启次数为 `10`。这表示 agent 如果在短时间内持续秒退，不会无限拉起刷满系统日志，而是停下来等待人工处理。

### 为什么 Web 容器里要配置 `NEXT_PUBLIC_SERVER_URL=http://server:4000`

因为 Next.js 在服务端渲染时需要访问中枢服务。在 Docker 网络里，`server` 是中枢容器名。

### 可以不使用 MySQL 吗

可以，服务端会降级到本地 JSON 历史存储，但不建议作为正式部署方案。

### 可以把 Redis / MySQL 换成外部服务吗

可以，修改 `.env` 中的 `REDIS_URL`、`MYSQL_URL`，并按需精简 `docker-compose.yml`。
