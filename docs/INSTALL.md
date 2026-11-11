# 部署与安装指南

观澜的安装参数、中枢部署和运维细节都在这一份。只想把客户端跑起来，看 [README](../README.md) 就够。

## 客户端

三个平台的安装包都在 [GitHub Releases](https://github.com/IGNGserver/guanlan-monitor/releases/latest)。请下载与当前版本对应的那份；`main` 分支不是安装源。

### Windows

**推荐 `DeviceStateConsole-Windows-Setup-v<版本>.exe`。** 常规 Windows 安装程序，装到 `%ProgramFiles%\DeviceStateConsoleAgent`，创建开始菜单与桌面快捷方式，并注册开机自启的机器级 Agent 服务；支持静默安装、更新和卸载。

- `DeviceStateConsole-Windows-Update-v<版本>.zip` 只用于已安装客户端的更新分发，不要拿它做首次安装。
- `DeviceStateConsole-Windows-Portable-v<版本>.zip` 是免安装的便携版。

安装后打开「观澜」，在「配置」页填中枢地址、访问密钥和设备名称。应用常驻系统托盘：左键打开主界面，右键看状态或退出。采集与上报由机器级服务负责，关窗口或注销登录都不中断。

**无桌面环境 / 无人值守**（静默安装 + 自动配置 + 校验首次上报）：

```powershell
& "DeviceStateConsole-Windows-Setup-vX.Y.Z.exe" /S `
    /HUB="https://hub.example.com" /KEY="<ACCESS_KEY>" `
    /DEVICE=node-01 /HOSTNAME="节点01" /VERIFY=120
```

- `/S` 静默安装；`guanlan-agent` 机器级服务会自动注册为开机自启。服务创建失败时回退成 `AtStartup` + SYSTEM 计划任务，不使用需要登录的启动项。
- 含斜杠的值（任何 URL）必须加引号。
- `/VERIFY=<秒>` 在安装结束前等待首次上报确认，超时返回退出码 3，方便 Intune/SCCM/Ansible 判定。不传 `/HUB` 就保持「装完再配置」。
- 机器级配置写到 `%ProgramData%\Guanlan\agent-ui.config.json`。

### Linux

下载 `DeviceStateConsole-Linux-Install-v<版本>.deb`，适用于 Ubuntu/Debian `amd64`。安装包以 Ubuntu 24.04 构建。

安装后提供 `/usr/bin/guanlan`（GNOME Linux 桌面端）和 `/usr/bin/guanlan-agent`。系统级 `guanlan-agent.service` 随安装启用（`WantedBy=multi-user.target`，不依赖 `graphical-session`），没有桌面会话也会持续采集与上报。首次打开桌面端可在「连接」页填写中枢地址和访问密钥；非提权用户只能查看状态，改机器级配置需要管理员权限。

**无桌面环境 / 无人值守**（一条命令装包 + 自动配置）：

```bash
sudo GUANLAN_HUB=https://hub.example.com GUANLAN_KEY="$KEY" GUANLAN_DEVICE_ID=node-01 \
  apt-get install -y ./DeviceStateConsole-Linux-Install-vX.Y.Z.deb
sudo guanlan-agent wait-for-upload --timeout 120   # 退出码 0 表示已确认上报
```

也可以先装后配：

```bash
sudo guanlan-agent config set --hub https://hub.example.com --key-stdin
# 或写 /etc/guanlan/agent.env 后：
sudo systemctl restart guanlan-agent
```

机器级配置位于 `/etc/guanlan/agent.json`（实际文件名 `agent-ui.config.json`）。

Fedora/RPM、Arch 等发行版暂时没有原生包，可以用任意进程管理器直接跑包内的 `device-state-console-agent`，再通过 `DSC_SERVER_URL`、`DSC_AGENT_SECRET`、`DSC_DEVICE_ID` 配置。

### Android

下载 `DeviceStateConsole-Android-v<版本>.apk` 安装。首次打开填与 Windows 端相同的中枢地址和查看密钥。

支持 `http://` 和 `https://`；没配 TLS 时只建议在可信局域网或受控内网穿透里用 HTTP。安装包用 `IGNGserver` 发布证书签名，系统提示未知来源时需要你手动允许。

### 随包的命令

`guanlan-agent` 随安装包发布，替代已下架的 `dsc`：

```text
guanlan-agent status [--json]        服务 / 配置 / 上报状态（退出码 0/3/4/5 可用于编排）
guanlan-agent doctor [--json]        服务 + 配置 + 中枢连通性检查
guanlan-agent config get|set|validate|export|import
guanlan-agent service install|uninstall|start|stop|status
guanlan-agent collector start|stop|restart
guanlan-agent probes status|detect
guanlan-agent wait-for-upload --timeout N
guanlan-agent onboarding-url
```

访问密钥只通过 `--key-stdin` 或 `--key-file` 传入，不会出现在进程参数里；`status`、`export` 和诊断输出全部脱敏。卸载默认保留机器级配置，只有 `--purge`（deb）或 `/REMOVECONFIG`（Windows）才会删掉。

## 连接中枢

客户端用下列地址之一。默认建议 HTTPS：

- 局域网 HTTP：`http://服务器IP:38472`
- 局域网：`https://服务器域名:38472`
- 公网：`https://你的域名`
- 受控 HTTP 内网穿透：`http://公网IP:转发端口`

所有客户端和 agent 都用同一个公开入口。**不要填 Docker 容器内部的 `4000` 端口**，那是 server 在 Compose 网络里的地址。

## 部署中枢

Docker Compose 只拉 GitHub Container Registry 里已发布的镜像，不从当前源码构建：

```bash
cp .env.example .env
DSC_VERSION=3.0.174 docker compose pull
DSC_VERSION=3.0.174 docker compose up -d
```

开发或测试环境要跟移动标签，可以显式选 `latest`；生产用固定版本或不可变 digest。

`.env` 里至少改这几个：

| 变量 | 说明 |
|---|---|
| `SESSION_SECRET` | Web 会话签名密钥。改了会让所有 Web 会话立即失效，不影响 Agent |
| `ACCESS_KEY` | 网页、Windows/Android 客户端和所有 agent 共用的唯一访问密钥。改了会让现有凭据全部失效 |
| `MYSQL_ROOT_PASSWORD` | 稳定版要求至少 16 个字符 |
| `MYSQL_PASSWORD` | 稳定版要求至少 6 个非占位符字符，建议用更长的随机值 |
| `REDIS_PASSWORD` | `REDIS_URL` 里要配同一个密码 |

升级时即使旧 `.env` 还留着 `AGENT_SHARED_SECRET`，也以 `ACCESS_KEY` 为准。

**TLS 与反向代理。** 生产环境默认经 TLS 反向代理访问控制台。`SESSION_COOKIE_SECURE` 与 `AGENT_REQUIRE_HTTPS` 默认保持 `true`；稳定和测试渠道都允许在明确受信的 HTTP 网络里把对应值设成 `false`，Compose 预检会保留你的配置。只有当 server 仅能被该受信代理访问时才设 `TRUST_PROXY=true`，否则保持 `false`。

静态 Web 镜像用 nginx，固定转发到 Compose 的 `server:4000`，不再读 Web 的 `SERVER_API_URL` / `NEXT_PUBLIC_SERVER_URL`。外层终止 TLS 时，必须在 `.env` 的 `DSC_TRUSTED_TLS_PROXY_CIDRS` 里填 **Web 容器实际看到的 TLS 代理源 IP/CIDR**（空格分隔），并让该代理覆盖 `X-Forwarded-Proto`。默认空列表不信任任何转发协议头；这时开着 `AGENT_REQUIRE_HTTPS` 会拒绝经 HTTP 到达 Web 的 Agent 请求，而不会静默降级。不要填客户端网段、默认路由或与不受信客户端共享的 NAT 源地址——用独立代理网络、端口绑定或防火墙隔离入口。部署前核实实际网络，不要直接抄 CI 用的容器 loopback 白名单。

Web 登录会话默认有效 90 天，持续使用会接近到期时自动续期，但不超过首次登录后的 365 天；长期不访问需要重新登录。

### 使用已有的 MySQL / Redis

机器上已经有一套供多个项目共用的 MySQL/Redis 时，不用再起数据库容器：

```bash
cp .env.example .env
# 编辑 .env：
#   DSC_DB_MODE=external
#   MYSQL_URL=mysql://guanlan:...@db.internal:3306/guanlan_home
#   REDIS_URL=rediss://:...@redis.internal:6379/3
#   DSC_INSTANCE_ID=hub-home
DSC_VERSION=3.0.174 docker compose -f docker-compose.external.yml pull
DSC_VERSION=3.0.174 docker compose -f docker-compose.external.yml up -d
```

这个文件只含 `server` 和 `web`，不创建 MySQL/Redis，也不暴露数据库端口。

- **每个中枢必须用独立的 database。** 表名固定，多个中枢写同一个库会被 `hub_meta` 拒绝。
- 多个项目共用一个 Redis 时，用不同的 `DSC_INSTANCE_ID` 隔离 key。当前是单写者架构，不支持多个中枢同时写一份数据。

外部 MySQL 需要 8.0+，并允许应用在自己的 database 内建表/改表；Redis 需要认证，建议开 AOF。权限 SQL、从内置数据库迁移、远程延迟参数见 [EXTERNAL_DATABASE.md](EXTERNAL_DATABASE.md)。

## 设备采集

- **Windows**：装上面的 setup，在应用内配置；无人值守用上面的静默参数。
- **Linux 桌面**：装上面的 `.deb`，在「连接」页配置；无桌面环境用环境变量或 `guanlan-agent config set`。
- **服务化**：安装包会注册机器级 `guanlan-agent` 服务（Windows 服务 / SYSTEM 计划任务，Linux systemd system 单元），开机即采集，无需登录。
- **升级**：Windows 用 setup/update 包，Linux 用新的 `.deb`，都会保留机器级配置。
- **网页控制台**：用 `.env` 里的 `ACCESS_KEY` 登录，选设备即可看实时数据和历史图表。

设备、硬件或驱动没提供的传感器显示为空，不影响设备上线。

## 发布规则

每个测试版或正式版 Release 的资产名都必须带平台和交付方式，包含四类：

1. `DeviceStateConsole-Windows-Setup-v<版本>.exe`（支持 `/S` 与无界面参数化安装）
2. `DeviceStateConsole-Windows-Portable-v<版本>.zip` 或更新包
3. `DeviceStateConsole-Linux-Install-v<版本>.deb`（内含系统级 systemd 服务）
4. `DeviceStateConsole-Android-v<版本>.apk`

不再单独发 CLI 资产——无桌面场景的能力内建在上述安装包和随包的 `guanlan-agent` 里。

仓库不提交安装包、APK、密钥、日志或本机配置；发布资产只上传到 GitHub Release。

## 开发与维护

构建、签名和发布流程：

- [Windows 客户端发布说明](../windows-agent/README.md)
- [Android 发布说明](../deploy/android-release.md)
- [Windows 打包运行手册](../deploy/windows-agent-release-runbook.md)
- [版本与发布规范](../RELEASE.md)
- [贡献指南](../CONTRIBUTING.md)

源码验证、Go/WinUI 构建、安装包生成、镜像发布和部署都由 GitHub Actions 执行。提交或推送后到 GitHub Actions 看对应 workflow、artifact、镜像和部署结果——本机不作为交付构建机。
