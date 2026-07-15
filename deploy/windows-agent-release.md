# Windows Agent Release

## Goal

生成一个可直接分发的 Windows 便携包目录，目录中同时包含：

- `DeviceStateConsoleAgent.WinUI.exe`
- `backend/windows-agent-backend.exe`
- `backend/device-state-console-agent.exe`
- `backend/windows-hardware/`

便携模式首次启动后，`agent-ui.config.json` 会写在程序根目录。安装模式应保持相同的二进制目录结构，但配置写入 `%LocalAppData%/DeviceStateConsoleAgent/`。

## Portable Build

推荐脚本：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\build-windows-agent-portable.ps1 -Zip
```

默认输出目录：

```text
release/windows-agent-portable/DeviceStateConsoleAgent/
```

## Inputs

脚本支持两种前端来源：

1. 当前机器具备 `.NET SDK` 与 `Windows App SDK`：
   脚本会尝试自动执行 `dotnet publish`。
2. 当前机器没有 `.NET SDK`，但仓库里已经存在可复用的 WinUI `Release` 输出：
   脚本会自动跳过 `dotnet publish`，并回退到现有的 WinUI 输出目录继续组装便携包。
3. 当前机器既无法构建 WinUI，也没有可复用的 WinUI 输出：
   先在具备 WinUI 工具链的机器上发布前端，再传入 `-WinUIPublishDir`。

WinUI 前端发布机建议具备：

- `.NET SDK 8`
- `Windows App SDK 1.6.x`
- Windows 10/11 x64 构建环境

如果需要一份面向构建机的逐步准备清单，可参考：

- `deploy/windows-build-machine-checklist.md`

示例：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\build-windows-agent-portable.ps1 `
  -WinUIPublishDir C:\artifacts\DeviceStateConsoleAgent.WinUI\publish `
  -Zip
```

## Notes

- 默认会重新构建 Go backend 与采集器。
- 若检测到当前 `dotnet` 只有 runtime、没有 SDK，脚本会先尝试复用仓库中现有的 WinUI `Release` 输出，避免中途把发布目录清空后失败。
- 若只想复用已有二进制，可传 `-SkipGoBuild`，脚本会优先读取：
  - `agents/windows-agent-backend.exe`
  - `agents/release/device-state-console-agent-windows-amd64.exe`
  - 若不存在，也会回退尝试 `agents/agent.exe`
- `backend/windows-hardware/` 会整目录复制，避免后续 Windows 侧硬件探测资产缺失。
- 这个脚本生成的是便携式分发目录，不等价于 MSIX/setup 安装包。

## Setup Build

当前仓库为安装版提供的是 Inno Setup 路线：

- 模板：`deploy/windows-agent-setup.iss`
- 构建脚本：`deploy/build-windows-agent-setup.ps1`

推荐流程：

1. 先准备便携包目录，作为安装包输入。
2. 在装有 Inno Setup 6 的机器上运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\build-windows-agent-setup.ps1
```

若当前机器没有 `ISCC.exe`，脚本会先生成：

```text
release/windows-agent-setup/windows-agent-setup.generated.iss
```

然后提示缺少 Inno Setup 编译器。把这份 `.iss` 带到有 Inno Setup 的机器上即可继续构建。

## Installer Notes

- 安装版会把程序安装到 `Program Files\DeviceStateConsoleAgent`
- WinUI 程序、backend、collector 和 `windows-hardware/` 保持与便携包一致的相对目录
- 安装后的本地配置仍写入 `%LocalAppData%/DeviceStateConsoleAgent/agent-ui.config.json`
- WinUI 前端随安装包一起携带 Windows App SDK 运行时文件，不再依赖系统预装 Windows App Runtime 1.6
- 便携包与 setup 不再额外携带 Windows App Runtime 1.6 离线安装包，只保留 `.NET Desktop Runtime 8` 的校验入口
- WinUI 拉起 backend 时会附带前端 PID；若 WinUI 异常退出，backend 会检测父进程消失并主动退出，同时结束 collector
- 这条安装路线当前是 `setup.exe` 方向，不是 MSIX 商店包方向
- 卸载时如果检测到 `%LocalAppData%\DeviceStateConsoleAgent\`，安装器会明确询问是否连本地配置与同步状态一起删除
- 默认建议选择“否”，这样重新安装后仍可恢复连接信息、本地偏好和待推送状态
- 若需要做真实安装器自动化验证，卸载阶段还支持显式参数：
  - `/uninstallconfig=retain`
  - `/uninstallconfig=delete`
- setup 构建前会先校验输入便携包是否包含前端 exe、backend、collector 以及关键 `windows-hardware/` 资产；缺件时会直接阻断构建
- WinUI 首启时会根据当前是便携还是安装模式，直接展示模式说明、推荐操作顺序，以及当前本地配置/同步状态/诊断日志路径

## Validation Boundary

当前仓库已经验证：

- Go backend 可构建
- 便携包目录可由脚本组装
- setup 脚本可生成 `.iss`
- bundle 验证脚本可检查目录结构并烟测启动 packaged local backend
- 本地展示配置不会自动上云；只有显式调用 `/api/cloud/push` 才会同步到中枢
- 本地展示配置变更的“待推送”状态会由 backend 持久化，backend / WinUI 重启后仍可恢复
- 仅采样频次、实时模式、自动重启这类运行时配置变更不会误触发“待推送”，也不会提前生成同步状态文件
- 本地配置会直接改变 collector 实际发送的 ingest payload，关闭的类别不会继续按原样上报
- backend 被异常结束时，collector 会随 backend 一并退出，不残留孤儿进程
- WinUI 对应的父进程异常退出时，backend 会自行识别并主动退出，不继续残留在后台
- 网页查看驱动的实时模式会优先通过中枢主动下发控制流触发；控制流断开时，backend 会自动回退到低频轮询判断观看态
- 中枢的 agent control-stream 会定期重发当前 viewer 控制快照，降低 Windows 端长连接因静默超时而被中间层断开的概率
- 当 Windows 端 control-stream 长时间静默但底层连接未显式报错时，backend 会主动取消旧连接并自动重建 control-stream，而不是一直停留在“假在线”状态
- 当 viewer 页面短暂刷新、切换标签页或短时断流时，Windows backend 不会立刻退出 `viewer` 驱动的实时上传，而是按 agent 本地配置的 `viewerRealtimeHoldSeconds` 保持窗口延迟回落，减少 `5s/15s` 频率抖动
- WinUI 本地状态区会直接显示控制流状态、最近一次推送、最近一次断开时间、断开原因、主动重连次数与最近一次主动重连时间，便于现场区分“尚未建链”“已断开回退”“静默超时后正在主动重连”与“控制流已恢复”
- WinUI 会把“本地配置即时生效”和“云端展示显式同步”分开表达：本地改动先影响采集与发送，只有显式推送后网页/客户端才更新展示类别
- WinUI 当前已支持在 agent 端直接决定“发送哪些具体指标”，而不只是关闭整个类别；这些勾选会落到 `enabledMetrics`
- WinUI 当前已支持在实例级继续细化具体指标，例如可对单个 CPU / 磁盘 / 网卡 / 显卡实例单独关闭某些指标；这些勾选会落到 `instanceMetricConfig`
- 已有独立 verifier 证明 `instanceMetricConfig` 会真实影响 collector 发出的 ingest payload，而不是只停留在界面配置层
- WinUI 当前还会把控制流状态进一步区分为 `connected`、`connected-keepalive`、`recovering`、`fallback`、`idle`，帮助现场区分“已收到观看态变更”“当前只是保活”“静默超时后正在主动重连”“已回退轮询”与“首启待建链”
- 若 control-stream 在 Windows 端反复发生静默超时，WinUI 还会把链路健康度升级为更明显的弱稳定提示，提醒优先检查网络空闲超时、代理保活和休眠恢复后的连接状态
- 已有独立 verifier 证明 control-stream 在 Windows 端静默超时后会主动取消旧连接、记录重连次数，并重新建链，而不是只依赖 UI 文案或日志人工判断

当前仓库尚未在本机验证：

- WinUI `dotnet publish`
- Inno Setup 实际产出 `setup.exe`
- 安装后首启与卸载流程

建议先执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-build-prereqs.ps1 `
  -ReportPath .\release\windows-build-prereqs-report.json
```

若报告中 `readiness.*Ready` 仍为 `false`，可直接参考 `remediation.portableBuildBlockedBy`、`remediation.setupBuildBlockedBy`、`remediation.nextSteps` 和 `remediation.recommendedCommands` 来补齐构建机环境。

## Verification Script

新增：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-bundle.ps1 -BundleRoot <bundle-root>
```

它会检查：

- 前端 exe 是否存在
- `backend/` 目录与两个 Go exe 是否存在
- `windows-hardware/` 关键资产是否存在
- packaged local backend 是否能以指定 `bundle-root` / `config-root` 启动并响应 `/api/state`
- backend state 中返回的 `configPath`、`syncStatePath`、`diagnosticsPath` 是否落在预期模式对应的目录
- backend state 中返回的 `configFileExists`、`syncStateFileExists`、`diagnosticsFileExists` 是否与真实落盘状态一致
- 可选输出一份 JSON 验证报告

新增：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-instance-metric-config.ps1 -BundleRoot <bundle-root>
```

它会检查：

- 某个 CPU 实例被显式配置为“本实例指标全关”后，实例级字段不会继续按原样发送
- 某个磁盘实例仅保留 `diskUsage` 后，容量字段仍保留，而磁盘读写速率被清零
- `instanceMetricConfig` 对 ingest payload 的影响有独立 JSON 报告，而不是只通过 UI 或 cloud push 间接证明

新增：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-setup-template.ps1
```

它会静态检查安装模板是否仍满足这些关键策略：

- 安装目录仍为 `Program Files\DeviceStateConsoleAgent`
- 安装权限仍需管理员
- `%LocalAppData%\DeviceStateConsoleAgent\` 仍作为安装模式本地配置目录
- 开始菜单快捷方式仍会默认创建
- 桌面快捷方式仍保持为用户可选任务
- 卸载时仍会提示是否删除本地配置目录
- 只有用户明确确认后，才会真正删除本地配置目录

新增：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-setup-generated.ps1 -OutputDir <setup-output-dir>
```

它会在 generated `.iss` 校验之外，再确认 setup 的输入便携包仍包含这些关键资产：

- `DeviceStateConsoleAgent.WinUI.exe`
- `backend/windows-agent-backend.exe`
- `backend/device-state-console-agent.exe`
- `backend/windows-hardware/librehardwaremonitor/LibreHardwareMonitorLib.dll`
- `backend/windows-hardware/pawnio/PawnIO_setup.exe`
- 开始菜单快捷方式和桌面快捷方式任务定义仍保留在生成版 `.iss` 中

新增：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-installed-layout.ps1
```

它用于在真正安装 `setup.exe` 后验证：

- 安装目录内是否存在前端 exe、backend、collector、卸载器和关键硬件资产
- 开始菜单快捷方式是否已创建
- 本地配置是否落在 `%LocalAppData%\DeviceStateConsoleAgent\`
- 安装目录内是否没有误生成 `agent-ui.config.json`
- 安装版 backend 在指定 `config-root` 下是否能正常响应 `/api/state`
- 当已首启应用并要求本地配置工件存在时，backend state 中的 `configFileExists`、`diagnosticsFileExists`、`syncStateFileExists` 是否与真实文件状态一致
- 默认检查系统公共开始菜单目录；若测试环境无权限写入，可通过 `-StartMenuProgramsRoot` 指向可控目录

新增：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-uninstall-result.ps1 -ConfigExpectation retained
```

或：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-uninstall-result.ps1 -ConfigExpectation deleted
```

它用于在真正卸载后验证：

- 安装目录是否已经被移除
- 开始菜单快捷方式是否已经被移除
- 安装版相关进程是否不再残留
- 卸载注册表项是否已经消失
- 本地配置目录是否按用户选择被保留或删除
- 默认检查系统公共开始菜单目录；若测试环境无权限写入，可通过 `-StartMenuProgramsRoot` 指向可控目录

新增：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-setup-lifecycle.ps1 -RequireInstalledLayout -RequireUninstallRetained
```

它用于把 setup 模板、generated `.iss`、安装后验证、卸载后验证汇总成一份生命周期报告，便于在真实构建机/安装机上快速判断是否已经达到可交付状态。

新增：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-setup-execution.ps1 `
  -SetupExePath .\release\windows-agent-setup\DeviceStateConsoleAgent-setup.exe `
  -OutputDir .\release\windows-agent-setup-execution
```

它用于在管理员 PowerShell 会话里把这条真实安装器链路一次跑完：

- 静默安装 `setup.exe`
- 验证安装后目录与 `%LocalAppData%` 本地配置路径
- 静默卸载并保留本地配置
- 再次静默安装
- 静默卸载并删除本地配置
- 最后汇总出 execution report 与 lifecycle report
- 并自动刷新：
  - `release/windows-agent-release-readiness-report.json`
  - `release/windows-agent-objective-audit.md`
  - `release/windows-agent-delivery-summary.md`

如果验证机不是全新环境，可以显式传：

```powershell
-ForceCleanup
```

但这个参数只适合一次性验证机，因为它会主动清理已有安装、开始菜单快捷方式和本地配置目录。

新增：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-release-readiness.ps1
```

它会把这三类证据继续汇总成一份发布就绪报告：

- `verify-windows-build-prereqs.ps1` 的工具链结果
- `verify-windows-agent-external-publish-package.ps1` 的分机出包链路结果
- `verify-windows-agent-suite.ps1` 的 backend / portable 行为结果
- `verify-windows-agent-setup-lifecycle.ps1` 的 setup 生命周期结果

报告会直接给出这些高层结论：

- `blockedByToolchain`
- `portableBuildReady`
- `setupBuildReady`
- `externalPublishPackageVerified`
- `portableSuiteVerified`
- `setupLifecycleVerified`
- `portableArtifactStateVerified`
- `installedArtifactStateVerified`
- `localArtifactStateVerified`
- `issueDiagnosisVerified`
- `controlStreamVerified`

其中：

- `portableArtifactStateVerified` 表示便携模式下的本地落盘状态已经具备自动化证据，至少覆盖：
  - bundle 烟测时 `configFileExists`、`syncStateFileExists`、`diagnosticsFileExists` 与真实落盘状态一致
  - 首启场景下 `configFileExists`、`diagnosticsFileExists` 已生成
  - 首次展示配置改动后 `sync-state` 会出现
- `installedArtifactStateVerified` 表示安装模式下的本地落盘状态已经具备自动化证据，至少覆盖：
  - 安装模式 backend state 会正确报告 `configFileExists`、`diagnosticsFileExists`
  - 首次展示配置改动后 `sync-state` 会出现
  - 此时 `cloudConfigPending` 也会同步变为 `true`
- `localArtifactStateVerified` 表示便携模式与安装模式这两套本地落盘证据都已经齐备，可直接用于判断“配置文件 / 同步状态 / 诊断日志”是否按设计写入对应位置

同时，发布就绪报告现在还会附带两类辅助信息：

- `evidence`
  用于说明当前已经汇总到了哪些自动化证据，以及这些证据的来源路径。例如：
  - `externalPublishPackage.publishDir`
  - `externalPublishPackage.usedMockPublishDir`
  - `externalPublishPackage.usedGoBuild`
  - `portableSuite.summaryPath`
  - `setupLifecycle.summaryPath`
- `remediation`
  用于在工具链未就绪时直接给出修复方向，例如：
  - `portableBuildBlockedBy`
  - `setupBuildBlockedBy`
  - `nextSteps`
  - `recommendedCommands`

其中 `controlStreamVerified` 表示这些控制链路场景都已有自动化证据：

- 控制流可用时，观看态会通过主动下发进入实时模式
- viewer 短暂离开后，agent 会按保持窗口延迟回落，而不是立刻从实时切回常态
- 控制流不可用时，backend 会自动回退到低频轮询
- 首启时控制流默认未连接，且不存在历史事件时间
- WinUI 会把控制流最近一次断开时间与断开原因展示给用户

其中 `issueDiagnosisVerified` 表示“Windows 端掉线或异常后，WinUI / backend 是否能把问题类别与恢复结果清晰暴露出来”已经有自动化证据，例如：

- 最近异常分类可以区分 `upload`、`cpu_slow`、`disk_slow`、`network_slow` 等类型
- 连续同类异常会累计次数，而不是只保留最后一条模糊报错
- 异常恢复后会记录 `issueRecoveredAt`
- 恢复后连接状态会回到 `connected`

更完整的人工验收步骤见：

- `deploy/windows-agent-acceptance-checklist.md`
- `deploy/windows-agent-release-runbook.md`

## Delivery Summary

当你已经拿到以下三类报告后：

- `verify-windows-build-prereqs.ps1`
- `verify-windows-agent-release-readiness.ps1`
- `verify-windows-agent-external-publish-package.ps1`

可以继续导出一份适合交付、汇报或跨机器交接的 Markdown 摘要：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\export-windows-agent-delivery-summary.ps1
```

默认输出：

```text
.codex-artifacts/windows-agent-delivery-summary.md
```

这份摘要会统一整理：

- 当前是否被工具链阻塞
- portable / setup 是否已经达到构建就绪
- 外部 WinUI publish 打包验证是否通过
- portable 套件、setup 生命周期、issue diagnosis、control stream 验证是否已具备证据
- 当前阻塞项、下一步动作和推荐命令

如果你需要把报告输出到 release 目录，也可以显式传入：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\export-windows-agent-delivery-summary.ps1 `
  -BuildPrereqsReportPath .\release\windows-build-prereqs-report.json `
  -ReleaseReadinessReportPath .\release\windows-agent-release-readiness-report.json `
  -ExternalPublishPackageReportPath .\release\windows-agent-external-publish-package\external-publish-package-report.json `
  -OutputPath .\release\windows-agent-delivery-summary.md
```

## Objective Audit

如果你想直接按“Windows agent 最初目标是否已经逐条满足”来查看当前证据，而不是自己在多份报告之间来回比对，也可以导出一份目标审计摘要：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\export-windows-agent-objective-audit.ps1
```

默认输出：

```text
.codex-artifacts/windows-agent-objective-audit.md
```

这份摘要会把这些目标逐条映射到当前证据：

- WinUI 3 桌面应用主线
- portable / setup 交付形态
- Go backend 与前后端共同启动退出
- 便携模式与安装模式的本地落盘位置
- 连接配置、频次调整、探测方案、实例开关
- 本地自动保存与显式推送到中枢
- viewer-driven realtime / control-stream

并直接标出每一项当前是：

- `Verified`
- `Partially verified`
- `Blocked by toolchain`
- `Not verified`
