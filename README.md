# 观澜

观澜是用于查看电脑和服务器运行状态的私有部署监控工具。它提供 Web 控制台、Windows 桌面端、GNOME Linux 桌面端和 Android 客户端，可查看 CPU、内存、磁盘、网络、显卡和风扇等实时数据与历史趋势。桌面端按 CPU、硬盘、网卡、显卡和风扇实例分别展示使用率、频率、温度、容量与读写/收发速率。

开发版本号以仓库根目录的 `VERSION` 为准。用户安装请以 [GitHub Releases](https://github.com/IGNGserver/guanlan-monitor/releases/latest) 中的稳定版本为准；`main` 分支不是稳定安装源。

## 下载与安装

请从 [GitHub Releases](https://github.com/IGNGserver/guanlan-monitor/releases/latest) 下载与当前版本对应的客户端。

### 无桌面环境安装（Windows / Linux）

桌面版就是唯一发行版；同一份安装包在无桌面会话的机器上也能完成安装、配置、
开机自启与上报，不需要单独下载 CLI 版。

**Windows**（静默安装 + 自动配置 + 自动校验首次上报）：

```powershell
& "DeviceStateConsole-Windows-Setup-vX.Y.Z.exe" /S `
    /HUB="https://hub.example.com" /KEY="<ACCESS_KEY>" `
    /DEVICE=node-01 /HOSTNAME="节点01" /VERIFY=120
```

- `/S` 静默安装；`guanlan-agent` 机器级服务会自动注册为开机自启（若服务无法
  创建则回退为 `AtStartup` + SYSTEM 计划任务，绝不使用需要登录的启动项）。
- 含斜杠的值（任何 URL）必须加引号。
- `/VERIFY=<秒>` 会在安装结束前等待首次上报确认；超时返回退出码 3，便于
  Intune/SCCM/Ansible 判定。不传 `/HUB` 时保持“装完再配置”的行为。
- 机器级配置写入 `%ProgramData%\Guanlan\agent-ui.config.json`。

**Linux**（一条命令装包 + 自动配置）：

```bash
sudo GUANLAN_HUB=https://hub.example.com GUANLAN_KEY="$KEY" GUANLAN_DEVICE_ID=node-01   apt-get install -y ./DeviceStateConsole-Linux-Install-vX.Y.Z.deb
sudo guanlan-agent wait-for-upload --timeout 120   # 退出码 0 表示已确认上报
```

- `.deb` 安装时会启用系统级 `guanlan-agent.service`（`WantedBy=multi-user.target`，
  不依赖 `graphical-session`），因此无人登录也会持续采集与上报。
- 也可以先装后配：`sudo guanlan-agent config set --hub ... --key-stdin`，
  或写 `/etc/guanlan/agent.env` 后 `systemctl restart guanlan-agent`。
- 机器级配置位于 `/etc/guanlan/agent.json`（实际文件名 `agent-ui.config.json`）。

**无界面命令**（随包发布，替代已下架的 `dsc`）：

```text
guanlan-agent status [--json]        服务/配置/上报状态（退出码 0/3/4/5 可用于编排）
guanlan-agent doctor [--json]        服务 + 配置 + 中枢连通性检查
guanlan-agent config get|set|validate|export|import
guanlan-agent service install|uninstall|start|stop|status
guanlan-agent collector start|stop|restart
guanlan-agent probes status|detect
guanlan-agent wait-for-upload --timeout N
guanlan-agent onboarding-url
```

访问密钥只通过 `--key-stdin` 或 `--key-file` 传入，不会出现在进程参数里；
`status`/`export`/诊断输出全部脱敏。卸载默认保留机器级配置，只有
`--purge`（deb）或 `/REMOVECONFIG`（Windows）才删除。

### Windows

**推荐下载 `DeviceStateConsole-Windows-Setup-v<版本>.exe`。** 这是常规 Windows 安装程序，安装到 `%ProgramFiles%\DeviceStateConsoleAgent`，创建开始菜单与桌面快捷方式，并注册开机自启的机器级 Agent 服务；支持静默安装、更新和卸载。

`DeviceStateConsole-Windows-Update-v<版本>.zip` 仅用于已安装客户端的更新分发，不应作为首次安装方式。`DeviceStateConsole-Windows-Portable-v<版本>.zip` 是无需安装的 Windows 便携版。

安装后打开“观澜”，在“配置”页填写中枢地址、访问密钥和设备名称。应用运行后会显示在系统托盘：左键打开主界面，右键查看状态或退出。采集与上报由机器级服务负责，关闭窗口或注销登录都不会中断。

### Linux

下载 `DeviceStateConsole-Linux-Install-v<版本>.deb`，适用于 Ubuntu/Debian
`amd64`。安装后提供 `/usr/bin/guanlan` 桌面端与 `/usr/bin/guanlan-agent`
命令；系统级 `guanlan-agent.service` 会随安装启用，无桌面会话也会持续采集与
上报。首次打开桌面端可在“连接”页填写中枢地址和访问密钥；非提权用户
只能查看状态，修改机器级配置需要管理员权限。

该安装包以 Ubuntu 24.04 构建，目标为 Debian 系 `amd64`。Fedora/RPM、Arch
等发行版可在不改变现有架构的前提下增加对应的原生包格式；在此之前这些系统
可以直接以任意进程管理器运行包内的 `device-state-console-agent`，并通过
`DSC_SERVER_URL`/`DSC_AGENT_SECRET`/`DSC_DEVICE_ID` 配置。

### Android

下载 `DeviceStateConsole-Android-v<版本>.apk` 并安装。首次打开时填写与 Windows 端相同的中枢地址和查看密钥。Android 客户端支持 `http://` 和 `https://`；未配置 TLS 时仅建议在可信局域网或受控内网穿透中使用 HTTP。

Android 安装包使用 `IGNGserver` 发布证书签名。Android 在提示未知来源安装时，需要由用户确认允许该来源安装应用。

## 连接中枢

客户端通常使用下列地址之一（默认建议 HTTPS；稳定和测试渠道均可在明确受信的 HTTP 网络中通过部署参数启用 HTTP）：

- 局域网 HTTP：`http://服务器IP:3100`
- 局域网：`https://服务器域名:3100`
- 公网：`https://你的域名`
- 受控 HTTP 内网穿透：`http://公网IP:转发端口`

所有客户端和 agent 都应使用同一个公开入口。不要将 Docker 容器内部的 `4000` 端口填入客户端。

## 部署中枢

Docker Compose 默认只拉取 GitHub Container Registry 中已发布的应用镜像，不会从当前仓库源码构建：

```bash
cp .env.example .env
DSC_VERSION=0.2.294 docker compose pull
DSC_VERSION=0.2.294 docker compose up -d
```

开发或测试环境如果确实需要移动标签，可以显式选择 `latest`；生产环境必须使用固定版本或不可变 digest：

```bash
DSC_VERSION=latest docker compose pull
DSC_VERSION=latest docker compose up -d
```

至少修改 `.env` 内的 `SESSION_SECRET`、`ACCESS_KEY`、`MYSQL_ROOT_PASSWORD`、`MYSQL_PASSWORD` 与 `REDIS_PASSWORD`，并为 `REDIS_URL` 配置相同的认证密码。生产环境默认应通过 TLS 反向代理访问控制台；只有当 server 仅能从该受信代理访问时才设置 `TRUST_PROXY=true`，否则保持 `false`。`SESSION_COOKIE_SECURE` 与 `AGENT_REQUIRE_HTTPS` 默认保持 `true`，但稳定和测试渠道都允许在明确受信的 HTTP 网络中将对应值设置为 `false`，Compose 预检会保留用户配置。`ACCESS_KEY` 是网页、Windows/Android 客户端和所有 agent 共用的唯一访问密钥；升级时即使旧 `.env` 仍有 `AGENT_SHARED_SECRET`，也会以 `ACCESS_KEY` 为准。

Docker 配置见 [docker-compose.yml](docker-compose.yml)，Windows 与 Android 的专项说明见下方“开发与维护”。

## 设备采集

- Windows：安装上方的观澜 setup，可在应用内配置；无人值守场景使用上面的静默参数。
- Linux 桌面：安装上方的 `.deb`，在“连接”页配置；无桌面环境使用上面的环境变量或 `guanlan-agent config set`。
- 服务化：安装包会注册机器级 `guanlan-agent` 服务（Windows 服务/计划任务，Linux systemd system 单元），开机即采集，无需登录。
- 升级：Windows 使用 setup/update 包，Linux 使用新的 `.deb`；两种方式都会保留机器级配置。
- 网页控制台：使用 `.env` 中的 `ACCESS_KEY` 登录，选择设备即可查看实时数据和历史图表。

设备、硬件或驱动未提供的传感器会显示为空，不会阻塞设备上线。

## 发布规则

每个测试版或正式版 Release 都必须使用带平台和交付方式的资产名，并包含：

1. `DeviceStateConsole-Windows-Setup-v<版本>.exe`（支持 `/S` 与无界面参数化安装）。
2. `DeviceStateConsole-Windows-Portable-v<版本>.zip` 或更新包。
3. `DeviceStateConsole-Linux-Install-v<版本>.deb`（内含系统级 systemd 服务）。
4. `DeviceStateConsole-Android-v<版本>.apk`。

不再发布独立 CLI 发行资产；无桌面场景的能力内建于上述安装包与随包的
`guanlan-agent` 命令。

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
