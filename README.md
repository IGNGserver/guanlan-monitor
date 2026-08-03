# 观澜

观澜是用于查看电脑、服务器和虚拟机运行状态的私有部署监控工具。它提供 Web 控制台、Windows 桌面端、GNOME Linux 桌面端和 Android 客户端，可查看 CPU、内存、磁盘、网络、显卡和风扇等实时数据与历史趋势。桌面端按 CPU、硬盘、网卡、显卡和风扇实例分别展示使用率、频率、温度、容量与读写/收发速率。

开发版本号以仓库根目录的 `VERSION` 为准。用户安装请以 [GitHub Releases](https://github.com/IGNGserver/Device-State-Console/releases/latest) 中的稳定版本为准；`main` 分支不是稳定安装源。

## 下载与安装

请从 [GitHub Releases](https://github.com/IGNGserver/Device-State-Console/releases/latest) 下载与当前版本对应的客户端。

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

下载 `DeviceStateConsole-Android-v<版本>.apk` 并安装。首次打开时填写与 Windows 端相同的中枢地址和查看密钥。

Android 安装包使用 `IGNGserver` 发布证书签名。Android 在提示未知来源安装时，需要由用户确认允许该来源安装应用。

## 连接中枢

客户端通常使用下列地址之一：

- 局域网：`http://服务器IP:3100`
- 公网：`https://你的域名`

所有客户端和 agent 都应使用同一个公开入口。不要将 Docker 容器内部的 `4000` 端口填入客户端。

## 部署中枢

Docker Compose 默认只拉取 GitHub Container Registry 中已发布的应用镜像，不会从当前仓库源码构建：

```bash
cp .env.example .env
DSC_VERSION=0.1.111 docker compose pull
DSC_VERSION=0.1.111 docker compose up -d
```

也可以明确选择 Docker Hub 的移动标签：

```bash
DSC_VERSION=latest docker compose pull
DSC_VERSION=latest docker compose up -d
```

至少修改 `.env` 内的 `SESSION_SECRET`、`ACCESS_KEY`、`MYSQL_ROOT_PASSWORD` 与 `MYSQL_PASSWORD`。`ACCESS_KEY` 是网页、Windows/Android 客户端和所有 agent 共用的唯一访问密钥；升级时即使旧 `.env` 仍有 `AGENT_SHARED_SECRET`，也会以 `ACCESS_KEY` 为准。启动后通过 `http://服务器IP:3100` 访问控制台。

Docker 配置见 [docker-compose.yml](docker-compose.yml)，Windows 与 Android 的专项说明见下方“开发与维护”。

## 设备采集

- Windows：优先安装上方的观澜 setup，在应用内完成探测、采集和中枢连接配置。
- Linux 桌面：优先安装上方的 GNOME `.deb`，在“本机 Agent”页完成配置；无桌面环境时使用 [Linux agent 安装脚本](deploy/install-agent.sh)。
- 脚本式 agent：使用按版本下载的 [Linux 安装入口](deploy/install-agent-from-release.sh) 或 [Windows 安装入口](deploy/install-agent-from-release.ps1)，显式指定 Release 版本。
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
