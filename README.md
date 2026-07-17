# 观澜

观澜是用于查看电脑、服务器和虚拟机运行状态的私有部署监控工具。它提供 Web 控制台、Windows 桌面端和 Android 客户端，可查看 CPU、内存、磁盘、网络、显卡和风扇等实时数据与历史趋势。Windows 端按 CPU、硬盘、网卡、显卡和风扇实例分别展示使用率、频率、温度、容量与读写/收发速率。

开发版本号以仓库根目录的 `VERSION` 为准。用户安装请以 [GitHub Releases](https://github.com/IGNGserver/Device-State-Console/releases/latest) 中的稳定版本为准；`main` 分支不是稳定安装源。

## 下载与安装

请从 [GitHub Releases](https://github.com/IGNGserver/Device-State-Console/releases/latest) 下载与当前版本对应的客户端。

### Windows

**推荐下载 `DeviceStateConsoleAgent-setup-<版本>.exe`。** 这是常规 Windows 安装程序，支持选择安装目录、开始菜单、桌面快捷方式、开机启动、更新、修复和卸载。

`DeviceStateConsoleAgent-update-<版本>.zip` 仅用于已安装客户端的更新分发，不应作为首次安装方式。

安装后打开“观澜”，在“配置”页填写中枢地址、Agent 密钥和设备名称。应用运行后会显示在系统托盘：左键打开主界面，右键查看状态或退出。

### Android

下载 `guanlan-android-v<版本>.apk` 并安装。首次打开时填写与 Windows 端相同的中枢地址和查看密钥。

Android 安装包使用 `IGNGserver` 发布证书签名。Android 在提示未知来源安装时，需要由用户确认允许该来源安装应用。

## 连接中枢

客户端通常使用下列地址之一：

- 局域网：`http://服务器IP:3100`
- 公网：`https://你的域名`

所有客户端和 agent 都应使用同一个公开入口。不要将 Docker 容器内部的 `4000` 端口填入客户端。

## 部署中枢

在开发环境中，可以从当前源码启动 Docker Compose：

```bash
cp .env.example .env
docker compose up -d --build
```

生产环境必须先切换到已验收的版本 tag，再显式传入版本号：

```bash
git fetch --tags
git checkout v0.1.105
DSC_VERSION=0.1.105 docker compose up -d --build
```

至少修改 `.env` 内的 `SESSION_SECRET`、`ACCESS_KEY`、`MYSQL_ROOT_PASSWORD`、`MYSQL_PASSWORD` 与 `AGENT_SHARED_SECRET`。启动后通过 `http://服务器IP:3100` 访问控制台。

Docker 配置见 [docker-compose.yml](docker-compose.yml)，Windows 与 Android 的专项说明见下方“开发与维护”。

## 设备采集

- Windows：优先安装上方的观澜 setup，在应用内完成探测、采集和中枢连接配置。
- Linux：使用 [Linux agent 安装脚本](deploy/install-agent.sh)。
- 脚本式 agent：使用按版本下载的 [Linux 安装入口](deploy/install-agent-from-release.sh) 或 [Windows 安装入口](deploy/install-agent-from-release.ps1)，显式指定 Release 版本。
- 网页控制台：使用 `.env` 中的 `ACCESS_KEY` 登录，选择设备即可查看实时数据和历史图表。

硬件、驱动或虚拟机未提供的传感器会显示为空，不会阻塞设备上线。

## 发布规则

每个正式 Release 必须同时包含以下三项：

1. Windows setup 安装程序。
2. Windows update ZIP。
3. 已签名 Android APK。
4. Windows x64 CLI agent ZIP。
5. Linux x64 CLI agent ZIP。

仓库不会提交安装包、APK、密钥、日志或本机配置。发布资产只上传到 GitHub Release。

## 开发与维护

开发、构建、签名和发布流程：

- [Windows 客户端发布说明](windows-agent/README.md)
- [Android 发布说明](deploy/android-release.md)
- [Windows 打包运行手册](deploy/windows-agent-release-runbook.md)
- [GitHub Release 发布脚本](deploy/publish-github-release.ps1)
- [版本与发布规范](RELEASE.md)

运行 `pnpm typecheck`、`go build ./...` 和 WinUI 构建可验证源码变更。
