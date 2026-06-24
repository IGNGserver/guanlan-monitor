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

## 开源发布状态

这个仓库已经整理为适合首次公开发布的基础状态：

- 提供了生产可用的 `docker-compose.yml`
- 增加了 `LICENSE`、`CONTRIBUTING.md`、`SECURITY.md`
- 增加了 GitHub Actions CI
- 清理了构建产物忽略规则

如果你要首次发布到 GitHub，建议先在一台干净机器上完整跑完下面的“快速部署”和“本地开发”流程。

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

```bash
docker compose up -d --build
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

## Agent 一键部署

### Linux

在项目目录中执行：

```bash
sudo bash deploy/install-agent.sh \
  --server-url http://你的中枢IP:4000 \
  --secret 你的agent密钥 \
  --device-id node-001
```

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

## 首次发布到 GitHub 的建议流程

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin <你的仓库地址>
git push -u origin main
```

发布前至少确认：

- `pnpm typecheck` 通过
- `pnpm build` 通过
- `docker compose up -d --build` 可启动
- README 中的命令可以在干净环境复现
