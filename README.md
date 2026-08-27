# 观澜

观澜是用于查看电脑、服务器和虚拟机运行状态的私有部署监控工具。它提供 Web 控制台、Windows 桌面端、GNOME Linux 桌面端和 Android 客户端，可查看 CPU、内存、磁盘、网络、显卡和风扇等实时数据与历史趋势。桌面端按 CPU、硬盘、网卡、显卡和风扇实例分别展示使用率、频率、温度、容量与读写/收发速率。

开发版本号以仓库根目录的 `VERSION` 为准。用户安装请以 [GitHub Releases](https://github.com/IGNGserver/guanlan-monitor/releases/latest) 中的稳定版本为准；`main` 分支不是稳定安装源。

## 下载与安装

请从 [GitHub Releases](https://github.com/IGNGserver/guanlan-monitor/releases/latest) 下载与当前版本对应的客户端。

### CLI UI（Windows/Linux）

CLI Release 包现在包含 `dsc` 终端配置界面、采集器和本地 backend。安装脚本固定指向
指定的 GitHub Release tag，不从 `main` 分支拉取源码；脚本下载后的 ZIP 还会校验
SHA-256。将命令中的 `X.Y.Z` 替换为目标版本即可：

```bash
curl -fsSL https://github.com/IGNGserver/guanlan-monitor/releases/download/vX.Y.Z/install-cli.sh | bash -s -- --run
```

上面的 Linux 命令会安装到当前用户的 `~/.local/bin`，并立即进入 CLI UI；不使用
`--run` 时，打开新终端后执行 `dsc`。Windows PowerShell 可执行：

```powershell
$script = Invoke-WebRequest 'https://github.com/IGNGserver/guanlan-monitor/releases/download/vX.Y.Z/install-cli.ps1'
& ([scriptblock]::Create($script.Content)) -Run
```

进入页面后可以修改中枢连接、采样间隔、指标、硬件探针、云同步和采集器运行状态。
常用无界面命令包括 `dsc status`、`dsc doctor`、`dsc config get`、`dsc config set`，
退出 UI 不会停止后台 Agent；需要停止本地 CLI backend 时执行 `dsc shutdown`。

CLI 与桌面端共用 Agent 配置契约。默认配置文件位于
`%AppData%/device-state-console/agent-ui.config.json`（Windows）或
`$XDG_CONFIG_HOME/device-state-console/agent-ui.config.json`（Linux）；可用
`DSC_CLI_CONFIG_ROOT` 指定目录。TUI 和 `dsc config set` 都支持中枢连接、采样间隔、
本地记录、云同步、自动启动/重启、全局指标、探针 provider、设备实例开关和实例指标覆盖。

```text
dsc config validate [--file path]
dsc config export [--file path]       # 只导出脱敏配置
dsc config import --file path         # 脱敏 secret 为空时保留当前 secret
dsc config set --metrics all|none|key1,key2
dsc config push                       # 重试展示配置同步
```

`enabledMetrics` 缺省表示兼容旧配置的“全部指标”；显式写成 `[]` 才表示禁用全部指标。
远程中枢使用 HTTPS；仅 loopback、局域网或 link-local 地址允许 HTTP。访问密钥不会放在
CLI/backend 的进程参数中，诊断输出、状态接口和导出文件都会脱敏。

### Windows

**推荐下载 `DeviceStateConsole-Windows-GUI-Setup-v<版本>.exe`。** 这是常规 Windows 安装程序，支持选择安装目录、开始菜单、桌面快捷方式、开机启动、更新、修复和卸载。

`DeviceStateConsole-Windows-GUI-Update-v<版本>.zip` 仅用于已安装客户端的更新分发，不应作为首次安装方式。`DeviceStateConsole-Windows-GUI-Portable-v<版本>.zip` 是无需安装的 Windows GUI 便携版。

安装后打开“观澜”，在“配置”页填写中枢地址、访问密钥和设备名称。应用运行后会显示在系统托盘：左键打开主界面，右键查看状态或退出。

### Linux（GNOME）

下载 `DeviceStateConsole-Linux-GUI-Install-v<版本>.deb`，适用于 Ubuntu/Debian
`amd64`。它使用 GTK4/libadwaita 提供原生 Agent 配置页，并在同一个窗口内嵌
中枢网页查看实例和历史数据；界面会跟随 GNOME 的浅色、深色和高对比度设置。
首次打开后可在“本机 Agent”页填写中枢地址和访问密钥；后台采集服务由 systemd
user service 管理，没有 systemd user session 时会自动使用前台回退模式。

该首个 Linux GUI 安装包以 Ubuntu 24.04 构建，目标为 Debian 系 `amd64`。
Fedora/RPM、Arch 等发行版暂时继续使用 Linux CLI 安装包，后续可在不改变 GUI
架构的情况下增加对应的原生包格式。

### Android

下载 `DeviceStateConsole-Android-v<版本>.apk` 并安装。首次打开时填写与 Windows 端相同的 HTTPS 中枢地址和查看密钥。正式 APK 不允许明文 HTTP；局域网部署也应通过 TLS 反向代理提供 HTTPS。

Android 安装包使用 `IGNGserver` 发布证书签名。Android 在提示未知来源安装时，需要由用户确认允许该来源安装应用。

## 连接中枢

客户端通常使用下列地址之一（正式 Android APK 与生产 Agent 要求 HTTPS）：

- 局域网：`https://服务器域名:3100`
- 公网：`https://你的域名`

所有客户端和 agent 都应使用同一个公开入口。不要将 Docker 容器内部的 `4000` 端口填入客户端。

## 部署中枢

Docker Compose 默认只拉取 GitHub Container Registry 中已发布的应用镜像，不会从当前仓库源码构建：

```bash
cp .env.example .env
DSC_VERSION=0.2.287 docker compose pull
DSC_VERSION=0.2.287 docker compose up -d
```

开发或测试环境如果确实需要移动标签，可以显式选择 `latest`；生产环境必须使用固定版本或不可变 digest：

```bash
DSC_VERSION=latest docker compose pull
DSC_VERSION=latest docker compose up -d
```

至少修改 `.env` 内的 `SESSION_SECRET`、`ACCESS_KEY`、`MYSQL_ROOT_PASSWORD`、`MYSQL_PASSWORD` 与 `REDIS_PASSWORD`，并为 `REDIS_URL` 配置相同的认证密码。生产环境应通过 TLS 反向代理访问控制台；只有当 server 仅能从该受信代理访问时才设置 `TRUST_PROXY=true`，否则保持 `false`。`SESSION_COOKIE_SECURE=true` 与 `AGENT_REQUIRE_HTTPS=true` 会拒绝明文会话和 Agent 上传。`ACCESS_KEY` 是网页、Windows/Android 客户端和所有 agent 共用的唯一访问密钥；升级时即使旧 `.env` 仍有 `AGENT_SHARED_SECRET`，也会以 `ACCESS_KEY` 为准。

Docker 配置见 [docker-compose.yml](docker-compose.yml)，Windows 与 Android 的专项说明见下方“开发与维护”。

## 设备采集

- Windows：优先安装上方的观澜 setup，在应用内完成探测、采集和中枢连接配置。
- Linux 桌面：优先安装上方的 GNOME `.deb`，在“本机 Agent”页完成配置；无桌面环境时使用 [Linux agent 安装脚本](deploy/install-agent.sh)。
- 脚本式 agent：使用按版本下载的 [Linux 安装入口](deploy/install-agent-from-release.sh) 或 [Windows 安装入口](deploy/install-agent-from-release.ps1)，显式指定 Release 版本。
- CLI UI：使用上面的按版本 `install-cli.sh`/`install-cli.ps1` 一键安装入口，安装后用 `dsc` 打开终端配置页面；它适合无桌面环境或偏好终端操作的 Windows/Linux 主机。
- 安装后的 Windows/Linux CLI 可运行 `device-state-console-agent update`（Linux 使用 `sudo`），自动检查更高版本、校验 SHA-256 并完成服务重启；配置文件不会被覆盖。
- 网页控制台：使用 `.env` 中的 `ACCESS_KEY` 登录，选择设备即可查看实时数据和历史图表。

硬件、驱动或虚拟机未提供的传感器会显示为空，不会阻塞设备上线。

## 发布规则

每个测试版或正式版 Release 都必须使用带平台和交付方式的资产名，并包含：

1. `DeviceStateConsole-Windows-GUI-Setup-v<版本>.exe`。
2. `DeviceStateConsole-Windows-GUI-Portable-v<版本>.zip` 或更新包。
3. `DeviceStateConsole-Linux-GUI-Install-v<版本>.deb`。
4. `DeviceStateConsole-Android-v<版本>.apk`。
5. `DeviceStateConsole-Windows-CLI-Install-v<版本>.zip`。
6. `DeviceStateConsole-Linux-CLI-Install-v<版本>.zip`。
7. `install-cli.sh` 与 `install-cli.ps1`（固定版本 CLI UI 引导脚本）。

仓库不会提交安装包、APK、密钥、日志或本机配置。发布资产只上传到 GitHub Release。

## 开发与维护

开发、构建、签名和发布流程：

- [Windows 客户端发布说明](windows-agent/README.md)
- [Android 发布说明](deploy/android-release.md)
- [Android Release 打包脚本](deploy/package-android-release.ps1)
- [Windows 打包运行手册](deploy/windows-agent-release-runbook.md)
- [GitHub Release 发布脚本](deploy/publish-github-release.ps1)
- [版本与发布规范](RELEASE.md)

源码验证、Go/WinUI 构建、安装包生成、镜像发布和部署均由 GitHub Actions
执行。提交或推送后请在 GitHub Actions 中查看对应 workflow、artifact、镜像
和部署结果；本地不作为交付构建机。
