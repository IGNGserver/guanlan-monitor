# 部署与安装指南

本文档包含观澜（Guanlan）的详细安装、部署与高级配置说明。

## 下载与安装

请从 [GitHub Releases](https://github.com/IGNGserver/guanlan-monitor/releases/latest) 下载与当前版本对应的客户端。

### 无桌面环境安装（Windows / Linux）

桌面版是唯一发行版；同一份安装包在无桌面会话的机器上也能完成安装、配置、开机自启与上报，不需要单独下载 CLI 版。

**Windows**（静默安装 + 自动配置 + 自动校验首次上报）：

```powershell
& "DeviceStateConsole-Windows-Setup-vX.Y.Z.exe" /S `
    /HUB="https://hub.example.com" /KEY="<ACCESS_KEY>" `
    /DEVICE=node-01 /HOSTNAME="节点01" /VERIFY=120
```

- `/S` 静默安装；`guanlan-agent` 机器级服务会自动注册为开机自启。
- `/VERIFY=<秒>` 会在安装结束前等待首次上报确认；超时返回退出码 3。
- 机器级配置写入 `%ProgramData%\Guanlan\agent-ui.config.json`。

**Linux**（一条命令装包 + 自动配置）：

```bash
sudo GUANLAN_HUB=https://hub.example.com GUANLAN_KEY="$KEY" GUANLAN_DEVICE_ID=node-01   apt-get install -y ./DeviceStateConsole-Linux-Install-vX.Y.Z.deb
sudo guanlan-agent wait-for-upload --timeout 120   # 退出码 0 表示已确认上报
```

- `.deb` 安装时会启用系统级 `guanlan-agent.service`，无人登录也会持续采集与上报。

**无界面命令**（随包发布）：

```text
guanlan-agent status [--json]
guanlan-agent doctor [--json]
guanlan-agent config get|set|validate|export|import
guanlan-agent service install|uninstall|start|stop|status
guanlan-agent collector start|stop|restart
guanlan-agent probes status|detect
guanlan-agent wait-for-upload --timeout N
guanlan-agent onboarding-url
```

### Windows
推荐下载 `DeviceStateConsole-Windows-Setup-v<版本>.exe`。这是常规 Windows 安装程序，安装到 `%ProgramFiles%\DeviceStateConsoleAgent`。

### Linux
下载 `DeviceStateConsole-Linux-Install-v<版本>.deb`，适用于 Ubuntu/Debian `amd64`。

### Android
下载 `DeviceStateConsole-Android-v<版本>.apk` 并安装。

## 部署中枢

Docker Compose 默认只拉取 GitHub Container Registry 中已发布的应用镜像：

```bash
cp .env.example .env
DSC_VERSION=0.2.294 docker compose pull
DSC_VERSION=0.2.294 docker compose up -d
```

### 使用外部 MySQL/Redis

如果设备上已有供多个项目共用的 MySQL/Redis，可以配置为使用外部数据库：

```bash
cp .env.example .env
# 编辑 .env，配置 DSC_DB_MODE=external 等
DSC_VERSION=3.0.170 docker compose -f docker-compose.external.yml pull
DSC_VERSION=3.0.170 docker compose -f docker-compose.external.yml up -d
```

完整说明、权限 SQL、从内置数据库迁移和远程延迟参数见 [docs/EXTERNAL_DATABASE.md](docs/EXTERNAL_DATABASE.md)。

## 设备采集

- **Windows/Linux**：安装对应安装包，可在应用内配置；无人值守场景使用上述静默参数。
- **服务化**：安装包会注册机器级 `guanlan-agent` 服务，开机即采集。
- **网页控制台**：使用 `.env` 中的 `ACCESS_KEY` 登录，选择设备即可查看。

设备、硬件或驱动未提供的传感器会显示为空，不会阻塞设备上线。
