# Windows Agent

这是 Windows 端新的桌面 agent 工程骨架，目标是：

- 使用 WinUI 3 提供可安装或便携式运行的图形界面
- 通过本地 Go backend 管理真正的采集器进程
- 前端与后端共同启动、共同退出
- 本地配置即时保存，云端展示配置通过按钮显式推送到中枢

## 目录

- `DeviceStateConsoleAgent.WinUI/`：WinUI 3 前端
- `../agents/cmd/windows-agent-backend/`：本地 Go backend
- `../agents/`：真正的采集器二进制

## 预期打包方式

- 便携版：WinUI 前端放在根目录，`backend/windows-agent-backend.exe` 与 `backend/device-state-console-agent.exe` 放在 `backend/` 下，配置写到便携目录
- 安装版：通过 `setup.exe` 安装，配置默认写到 `LocalAppData`
- WinUI 前端按 Windows App SDK 自带运行时发布，不再要求用户预先单独安装 Windows App Runtime

建议目录布局：

```text
DeviceStateConsoleAgent/
  DeviceStateConsoleAgent.WinUI.exe
  backend/
    windows-agent-backend.exe
    device-state-console-agent.exe
```

- 便携模式：`agent-ui.config.json` 写在 `DeviceStateConsoleAgent/`
- 安装模式：`agent-ui.config.json` 写在 `%LocalAppData%/DeviceStateConsoleAgent/`
- 无论哪种模式，backend 与采集器二进制都从 `backend/` 目录启动，不再与配置目录混用

当前仓库已补充两条构建脚本：

- `deploy/build-windows-agent-portable.ps1`
- `deploy/build-windows-agent-setup.ps1`

其中安装版当前明确走 `setup.exe` 路线，并基于 Inno Setup 模板 `deploy/windows-agent-setup.iss`。

同时，Windows backend 的验证脚本也已经覆盖连接自检链路，可用：

- `deploy/verify-windows-agent-connection-check.ps1`
- `deploy/verify-windows-agent-first-run.ps1`

它会验证“中枢不可达”“密钥错误”“设备尚未上报”“设备已被中枢识别”这几种结果是否按预期返回。
其中 `verify-windows-agent-first-run.ps1` 会从空配置目录启动 backend，验证首次启动时：

- `agent-ui.config.json` 会立即生成
- `agent-ui.backend.log` 会立即生成
- `agent-ui.sync-state.json` 不会提前生成
- 首次本地展示配置变更后，`agent-ui.sync-state.json` 与 `cloudConfigPending` 会一起出现

`deploy/verify-windows-agent-bundle.ps1` 也已扩展到校验由 `config-root` 驱动的本地路径行为：

- `agent-ui.config.json`
- `agent-ui.sync-state.json`
- `agent-ui.backend.log`

它会确认这些路径都落在预期配置目录下，并验证本地展示配置变更后 `cloudConfigPending` 与同步状态文件会一起出现。
现在它还会额外校验 backend state 中的：

- `configFileExists`
- `syncStateFileExists`
- `diagnosticsFileExists`

是否与实际落盘状态一致，避免 WinUI 展示的“已生成 / 尚未生成”与 backend 真正状态脱节。

如果要检查安装模板本身没有回退这些 setup 策略，还可以运行：

- `deploy/verify-windows-agent-setup-template.ps1`

它会静态确认安装路径、管理员权限、本地配置目录和“卸载时是否删除本地配置”的确认逻辑仍然存在。

如果当前机器还没有 `ISCC.exe`，但你想确认 setup 构建脚本产出的 `windows-agent-setup.generated.iss` 是否已经正确替换了路径和版本，也可以运行：

- `deploy/verify-windows-agent-setup-generated.ps1`

它会校验生成版 `.iss` 中的便携包路径、输出目录、版本号，以及卸载时的本地配置处理逻辑是否都还在。

WinUI 当前也会直接展示当前运行在：

- `便携模式`
- `安装模式`

并在右侧给出“首启引导”卡片，告诉用户下一步应该先补连接信息、先检查中枢连接，还是已经可以直接启动采集器。
主界面左侧还会固定展示“推荐顺序”工作流卡片，把 Windows 端现场操作拆成：

- `STEP 1` 中枢连接
- `STEP 2` 上传频次
- `STEP 3` 组件探测 / 类别选择
- `STEP 4` 实例级记录

WinUI 还会根据当前运行模式动态切换说明文案，明确告诉用户：

- 当前是 `便携模式` 还是 `安装模式`
- 当前本地配置会写到程序目录还是 `%LocalAppData%\DeviceStateConsoleAgent\`
- 首次启动后下一步该先补连接信息、先检查中枢连接，还是已经可以直接启动采集器

WinUI 工程当前按“非 MSIX 的 unpackaged 桌面应用”方向组织，便于便携包和 setup 两条分发路线共用同一套目录结构。

## 当前状态

- WinUI 前端已具备本地 backend 自启动、状态轮询、配置防抖自动保存、探测方案选择、推送展示配置等基础交互
- 当本地 backend 异常退出或长时间无响应时，WinUI 会自动尝试重新拉起；连续失败后会改为主动重启本地 backend 以恢复控制链路
- WinUI 启动 backend 时会传入前端进程 PID；若前端异常退出，本地 backend 会识别父进程消失并主动关闭，同时带着 collector 一并退出
- WinUI 主界面会直接展示本地 backend 的恢复状态、恢复次数与最近一次恢复结果，便于判断 Windows 端是否只是暂时掉线还是已经自动恢复
- 当 backend 进入等待恢复、恢复中或已恢复状态时，右侧控制区会出现对应的 InfoBar 提示，风险层级会比普通说明文案更显眼
- WinUI 也会把中枢实时控制链路拆成单独状态项展示，可直接看到是否已连通、最近一次推送、最近一次断开时间、断开原因、主动重连次数，以及当前是否已经回退到低频轮询
- 控制流状态当前会细分为 `connected`、`connected-keepalive`、`recovering`、`fallback`、`idle` 五类，便于区分“已收到真实观看态变更”“仅收到保活快照”“静默超时后正在主动重连”“已回退轮询”与“尚未建链”
- 控制流状态还会以 InfoBar 分级提示：已连通为成功态，主动重连中与已回退轮询为警告态，首次待建链为信息态
- 控制流断开原因会优先翻译为可读中文，例如中枢未提供接口、密钥不正确、连接失败或服务端主动关闭
- 控制流状态还会给出问题类别、建议操作和链路健康度摘要，例如区分配置问题、中枢能力缺失、网络异常、服务端主动断开，或“Windows 端近期已频繁发生静默超时重连”
- 已支持通过本地探测返回 CPU / 磁盘 / 网卡实例清单，并在 WinUI 内按实例开关记录
- 已支持在 WinUI 内继续按具体指标选择发送内容，例如分别控制 CPU 使用率、CPU 温度、磁盘读写速率、网络累计流量等
- WinUI 在保存本地配置与推送展示配置时，会保留已有的 `instanceMetricConfig`，避免误清空按实例维度的显示配置
- 展示配置的“待推送”状态已由本地 Go backend 持久化到本地同步状态文件，重启 WinUI / backend 后仍可恢复
- 本地 Go backend 仍通过 `127.0.0.1:17891` 提供控制 API，并负责拉起真正的采集器进程
- WinUI 是否已在当前机器完成编译验证，应以最新的 `release/windows-build-prereqs-report.json` 与相关发布报告为准，而不要依赖这份说明中的历史快照

## 当前交互要点

- 前端启动后会先拉起 `backend/windows-agent-backend.exe`
- 前端拉起 backend 时会附带 `--parent-pid <WinUI PID>`，backend 会持续监控这个父进程
- 如果本地 backend 在运行中异常掉线，前端会继续轮询状态并自动执行本地恢复
- backend 再从同一 `backend/` 目录管理 `device-state-console-agent.exe`
- 关闭 WinUI 窗口时会停止本地 backend，并连带结束其子进程树；如果 WinUI 异常退出，backend 也会因为父进程消失而主动退出
- WinUI 会直接显示当前本地配置路径、同步状态路径与诊断日志路径，便于现场确认当前运行在便携目录还是 `%LocalAppData%\DeviceStateConsoleAgent\`
- 首次使用时，未填完整连接信息前，启动采集器和推送云端按钮会保持禁用
- 配置项变更会自动写入本地 `agent-ui.config.json`
- 在真正启动采集器前，可以先通过“检查中枢连接”按钮验证 Server URL、Agent Secret 是否可用，并区分“中枢不可达”“密钥错误”“设备尚未上报”这几类结果
- 连接自检结果会在“中枢连接”区域以内嵌 InfoBar 形式高亮展示，成功、失败和“还需先上报一次”会有不同提示层级
- 会影响云端展示配置的本地改动会进入“待推送”状态，并写入 `agent-ui.sync-state.json`
- 点击“推送至云端”时才会调用中枢的 `POST /api/agent/device-config`
- 如果网页或客户端当前正在查看该设备，backend 会优先通过中枢 `control-stream` 收到观看态快照并自动切换到实时上传；若这条长连接暂时不可用，则会回退到 `/api/agent/device-realtime` 的低频轮询判断观看态
- 如果这条长连接表面仍连着、但长时间没有新的 viewer 快照，backend 会主动取消旧连接并重建 control-stream，避免 Windows 端停留在“静默假在线”状态
