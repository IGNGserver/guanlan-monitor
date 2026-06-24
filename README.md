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

### 3. 登录

访问：

- `http://你的主机IP:3000`

登录密钥：

- `.env` 中的 `ACCESS_KEY`

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
- `--install-dir`：可选，agent 安装目录，默认 `/opt/device-state-console-agent`。
- `--service-user`：可选，运行 systemd 服务的系统用户，默认 `dsc-agent`。

脚本会自动：

- 复制 agent 到 `/opt/device-state-console-agent`
- 写入 `agent.env`
- 创建 `dsc-agent` 系统用户
- 注册并启动 `device-state-console-agent.service`

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
- `-InstallDir`：可选，agent 安装目录，默认 `C:\ProgramData\DeviceStateConsoleAgent`。

脚本会把 agent 安装到 `C:\ProgramData\DeviceStateConsoleAgent`，并注册为开机启动的计划任务。

查看任务：

```powershell
Get-ScheduledTask -TaskName "Device State Console Agent"
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

参考 [deploy/agent.env.example](deploy/agent.env.example)。

systemd 示例文件位于：

- [deploy/device-state-console-agent.service](deploy/device-state-console-agent.service)

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

当前版本默认支持连接局域网中的 `http://` 中枢地址，适合未启用 HTTPS 的内网部署环境。

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

然后重新构建：

```bash
./android/gradlew -p android assembleRelease
```

配置完整后，release 构建会自动使用你的签名配置。

## 生产部署说明

- `docker-compose.yml` 面向单机部署，包含 Redis 和 MySQL。
- MySQL 表会由服务端自动初始化。
- Redis 与 MySQL 都挂载命名卷，容器重建不会直接丢数据。
- 如果要公网暴露，建议前面加 Nginx / Caddy，并只开放 Web 入口。

## 常见问题

### 为什么 Web 容器里要配置 `NEXT_PUBLIC_SERVER_URL=http://server:4000`

因为 Next.js 在服务端渲染时需要访问中枢服务。在 Docker 网络里，`server` 是中枢容器名。

### 可以不使用 MySQL 吗

可以，服务端会降级到本地 JSON 历史存储，但不建议作为正式部署方案。

### 可以把 Redis / MySQL 换成外部服务吗

可以，修改 `.env` 中的 `REDIS_URL`、`MYSQL_URL`，并按需精简 `docker-compose.yml`。
