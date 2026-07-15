# Windows Agent Release Runbook

## Goal

在具备 WinUI 与 Inno Setup 工具链的 Windows 构建机上，按固定顺序生成：

- 便携包目录
- setup 安装包
- 验证报告

## Inputs

- 已拉取当前仓库源码
- `.NET SDK 8`
- `Windows App SDK 1.6.x`
- Go
- Inno Setup 6

如果要按“同机完整出包”或“分机出包”两条路线准备环境，可先看：

- `deploy/windows-build-machine-checklist.md`

## Handoff Matrix

如果采用“WinUI 发布机 -> 打包机 -> 安装验证机”的分机路线，建议按下面这张交接表执行，而不是临时口头说明：

### A. WinUI 发布机

负责事项：

- 执行 `dotnet publish`
- 运行 `verify-windows-winui-publish.ps1`

应交付给下一台机器的产物：

- `DeviceStateConsoleAgent.WinUI` publish 目录
- `windows-winui-publish-report.json`

交接前最低检查：

- publish 目录内存在 `DeviceStateConsoleAgent.WinUI.exe`
- `windows-winui-publish-report.json` 中 `passed = true`

### B. 打包机

负责事项：

- 执行 `build-windows-agent-portable.ps1`
- 运行 `verify-windows-agent-bundle.ps1`
- 运行 `verify-windows-agent-suite.ps1`
- 执行 `build-windows-agent-setup.ps1`
- 运行 `verify-windows-agent-setup-template.ps1`
- 运行 `verify-windows-agent-setup-generated.ps1`

应交付给下一台机器的产物：

- `release/windows-agent-portable/DeviceStateConsoleAgent/`
- `release/windows-agent-portable/DeviceStateConsoleAgent-portable.zip`
- `release/windows-agent-suite/` 下的验证报告
- `release/windows-agent-setup/windows-agent-setup.generated.iss`
- 若本机已安装 `ISCC.exe`，还应额外交付 `setup.exe`

交接前最低检查：

- `bundle-report.json` 通过
- `suite-summary.json` 中 portable suite 相关检查通过
- `setup-template-report.json` 通过
- `setup-generated-report.json` 通过

### C. 安装验证机

负责事项：

- 运行真实 `setup.exe`
- 优先使用 `verify-windows-agent-setup-execution.ps1` 串起整条真实安装/卸载验证链
- 运行 `verify-windows-agent-installed-layout.ps1`
- 运行 `verify-windows-agent-uninstall-result.ps1`
- 运行 `verify-windows-agent-setup-lifecycle.ps1`
- 运行 `verify-windows-agent-release-readiness.ps1`
- 运行 `export-windows-agent-delivery-summary.ps1`

应沉淀的最终证据：

- `installed-layout-report.json`
- `uninstall-*.json`
- `windows-agent-setup-lifecycle-report.json`
- `windows-agent-release-readiness-report.json`
- `windows-agent-delivery-summary.md`

交接前最低检查：

- 安装模式布局验证通过
- 卸载验证通过
- lifecycle 报告可证明安装与卸载链路完成
- release readiness 只允许保留你明确接受的阻塞项

## Step 0: Verify Build Prerequisites

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-build-prereqs.ps1 `
  -ReportPath .\release\windows-build-prereqs-report.json
```

期望输出：

- `Portable build ready: True`
- 若要直接产出 setup 安装包，`Setup build ready: True`
- `release/windows-build-prereqs-report.json`

如果当前机器还不满足条件，报告中还应直接给出：

- `remediation.portableBuildBlockedBy`
- `remediation.setupBuildBlockedBy`
- `remediation.nextSteps`
- `remediation.recommendedCommands`

建议先把这些阻塞项清空，再继续后续构建步骤。典型情况包括：

- 缺少 `.NET SDK 8`
- Go 版本不足
- 缺少 `Inno Setup 6`

## Step 1: Build Portable Bundle

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\build-windows-agent-portable.ps1 -Zip
```

期望输出：

- `release/windows-agent-portable/DeviceStateConsoleAgent/`
- `release/windows-agent-portable/DeviceStateConsoleAgent-portable.zip`

如果当前机器本身不负责后续安装验证，建议这一步结束后至少把下面这些内容一起打包给下一台机器：

- `release/windows-agent-portable/DeviceStateConsoleAgent/`
- `release/windows-agent-portable/DeviceStateConsoleAgent-portable.zip`
- `release/windows-build-prereqs-report.json`

## Step 2: Verify Portable Bundle

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-bundle.ps1 `
  -BundleRoot .\release\windows-agent-portable\DeviceStateConsoleAgent `
  -ReportPath .\release\windows-agent-portable\bundle-report.json
```

如果只想在当前源码树里快速验证最新 backend/collector，也可以不传 `-BundleRoot`，脚本会先自动准备 `.codex-artifacts/verify-agent-bundle-latest/`。

期望输出：

- 后端烟测通过
- `release/windows-agent-portable/bundle-report.json`

如果想在当前机器上一口气跑完整套 backend 验证，也可以使用：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-suite.ps1 `
  -OutputDir .\release\windows-agent-suite
```

期望输出：

- `bundle-report.json`
- `autorestart-report.json`
- `issue-category-report.json`
- `cloud-push-report.json`
- `cloud-pending-persist-report.json`
- `local-config-payload-report.json`
- `parent-exit-report.json`
- `realtime-report.json`
- `viewer-realtime-report.json`
- `control-stream-fallback-report.json`
- `control-stream-keepalive-report.json`
- `suite-summary.json`

如果你准备把便携包和 setup 工作交给另一台机器，建议在这里额外一并交付：

- `bundle-report.json`
- `suite-summary.json`
- 如有需要，还可带上 `windows-agent-objective-audit.md` / `windows-agent-delivery-summary.md` 作为说明材料

如果你采用的是“分机出包”路线，建议在把 WinUI 发布目录交给 `build-windows-agent-portable.ps1` 之前，先执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-winui-publish.ps1 `
  -PublishDir C:\artifacts\DeviceStateConsoleAgent.WinUI\publish `
  -ReportPath .\release\windows-winui-publish-report.json
```

如果你还想验证“外部 WinUI publish 目录 -> 便携包组装”整条路径，可以继续执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-external-publish-package.ps1 `
  -OutputDir .\release\windows-agent-external-publish-package `
  -ReportPath .\release\windows-agent-external-publish-package\external-publish-package-report.json
```

## Step 3: Build Setup Installer

建议先做一次安装模板静态校验：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-setup-template.ps1 `
  -ReportPath .\release\windows-agent-setup\setup-template-report.json
```

期望输出：

- `Setup template verification passed.`
- `release/windows-agent-setup/setup-template-report.json`
- 报告中 `startMenuShortcutConfigured = true`
- 报告中 `desktopShortcutTaskConfigured = true`

如果当前机器还没有 `ISCC.exe`，建议继续做一次 generated `.iss` 校验：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-setup-generated.ps1 `
  -OutputDir .\release\windows-agent-setup `
  -Version 0.1.0 `
  -ReportPath .\release\windows-agent-setup\setup-generated-report.json
```

期望输出：

- `Generated ISS verification passed.`
- `release/windows-agent-setup/windows-agent-setup.generated.iss`
- `release/windows-agent-setup/setup-generated-report.json`
- 报告中 `bundleAssets.* = true`
- 报告中 `startMenuShortcutRetained = true`
- 报告中 `desktopShortcutTaskRetained = true`

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\build-windows-agent-setup.ps1 `
  -PortableBundleDir .\release\windows-agent-portable\DeviceStateConsoleAgent `
  -OutputDir .\release\windows-agent-setup `
  -Version 0.1.0
```

期望输出：

- `release/windows-agent-setup/windows-agent-setup.generated.iss`
- 若本机存在 `ISCC.exe`，还应额外得到 `setup.exe`

如果本机只能生成 `.iss`，这里就应该明确停手，并把这些内容交给安装了 Inno Setup 6 的机器继续：

- `release/windows-agent-portable/DeviceStateConsoleAgent/`
- `release/windows-agent-setup/windows-agent-setup.generated.iss`
- `release/windows-agent-setup/setup-generated-report.json`
- `release/windows-agent-setup/setup-template-report.json`

## Step 3b: Verify Installed Layout After Running setup.exe

在已实际安装完成后执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-installed-layout.ps1 `
  -RequireConfigArtifacts `
  -ReportPath .\release\windows-agent-setup\installed-layout-report.json
```

期望输出：

- `Installed layout verification passed.`
- `release/windows-agent-setup/installed-layout-report.json`
- 报告中 `frontendExeExists = true`
- 报告中 `backendExeExists = true`
- 报告中 `collectorExeExists = true`
- 报告中 `uninstallerExists = true`
- 报告中 `startMenuShortcutExists = true`
- 报告中 `installRootHasNoLocalConfig = true`
- 报告中 `backendSmokeTest.passed = true`
- 若使用 `-RequireConfigArtifacts`，报告中 `backendSmokeTest.configFileExistsReported = true`
- 若使用 `-RequireConfigArtifacts`，报告中 `backendSmokeTest.diagnosticsFileExistsReported = true`
- 若本地同步状态文件已经出现，报告中 `backendSmokeTest.syncStateFileExistsReported = true`

如果你还想在安装模式下主动验证“本地展示配置改动后 `sync-state` 会落盘”，可以改为：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-installed-layout.ps1 `
  -RequireConfigArtifacts `
  -RequireSyncStateAfterDisplayChange `
  -ReportPath .\release\windows-agent-setup\installed-layout-report.json
```

额外期望输出：

- 报告中 `backendSmokeTest.syncStateCreatedAfterDisplayChange = true`
- 报告中 `backendSmokeTest.syncStateFileExistsReportedAfterDisplayChange = true`
- 报告中 `backendSmokeTest.cloudConfigPendingAfterDisplayChange = true`

如果你希望在一台“干净的管理员验证机”上把真实安装、首启验证、保留配置卸载、再次安装、删除配置卸载整条链路一次跑完，优先使用：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-setup-execution.ps1 `
  -SetupExePath .\release\windows-agent-setup\DeviceStateConsoleAgent-setup.exe `
  -OutputDir .\release\windows-agent-setup-execution
```

期望输出：

- `windows-agent-setup-execution-report.json`
- `setup-template-report.json`
- `setup-generated-report.json`
- `installed-layout-report.json`
- `uninstall-retained-report.json`
- `uninstall-deleted-report.json`
- `windows-agent-setup-lifecycle-report.json`
- `release/windows-agent-release-readiness-report.json`
- `release/windows-agent-objective-audit.md`
- `release/windows-agent-delivery-summary.md`

注意：

- 该脚本必须在管理员 PowerShell 会话中执行
- 默认要求验证机起始状态干净
- 如果你确认这是一台一次性验证机，也可以显式传 `-ForceCleanup`
- 卸载阶段现在支持通过安装器参数显式指定：
  - `/uninstallconfig=retain`
  - `/uninstallconfig=delete`
- 脚本在真实安装器链路验证成功后，还会自动刷新 release readiness、objective audit 与 delivery summary，避免后续再手工补三步汇总

## Step 3c: Verify Uninstall Result After Running the Uninstaller

如果卸载时选择“否”，执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-uninstall-result.ps1 `
  -ConfigExpectation retained `
  -ReportPath .\release\windows-agent-setup\uninstall-retained-report.json
```

如果卸载时选择“是”，执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-uninstall-result.ps1 `
  -ConfigExpectation deleted `
  -ReportPath .\release\windows-agent-setup\uninstall-deleted-report.json
```

期望输出：

- `Uninstall result verification passed.`
- 报告中 `installRootRemoved = true`
- 报告中 `startMenuShortcutRemoved = true`
- 报告中 `noInstalledProcessRunning = true`
- 报告中 `uninstallRegistryEntryRemoved = true`
- 报告中 `configRootStateMatchesExpectation = true`

## Step 3d: Aggregate Setup Lifecycle Evidence

如果已经完成安装后验证，并在卸载时选择了“否”，执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-setup-lifecycle.ps1 `
  -RequireInstalledLayout `
  -RequireUninstallRetained `
  -ReportPath .\release\windows-agent-setup\setup-lifecycle-report.json
```

如果还额外完成了“选择是后删除配置”的卸载验证，可附加：

```powershell
  -RequireUninstallDeleted
```

期望输出：

- `Setup lifecycle verification passed.`
- 报告中 `summary.passed = true`

## Step 4: Verify Auto Restart

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-autorestart.ps1 `
  -BundleRoot .\release\windows-agent-portable\DeviceStateConsoleAgent `
  -ReportPath .\release\windows-agent-portable\autorestart-report.json
```

不传 `-BundleRoot` 时，会自动准备最新 backend 验证 bundle。

期望输出：

- 自动重启验证通过
- `restartCount >= 1`
- `lastExitCode = 7`
- `diagnosticsObserved = true`
- `release/windows-agent-portable/autorestart-report.json`

## Step 5: Verify Issue Category

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-issue-category.ps1 `
  -BundleRoot .\release\windows-agent-portable\DeviceStateConsoleAgent `
  -ReportPath .\release\windows-agent-portable\issue-category-report.json
```

不传 `-BundleRoot` 时，会自动准备最新 backend 验证 bundle。

期望输出：

- 异常分类验证通过
- `issueObserved = true`
- `issueCategory = upload`
- `issueCount >= 1`
- `recoveryObserved = true`
- `issueRecoveredAt` 非空
- `recoveredConnectionStatus = connected`
- `release/windows-agent-portable/issue-category-report.json`

在 `verify-windows-agent-suite.ps1` 的汇总结果中，这一项现在还会体现在：

- `checks.issueCategoryObserved = true`
- `checks.issueCategoryRecoveryObserved = true`

## Step 6: Verify Realtime Mode

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-realtime-mode.ps1 `
  -BundleRoot .\release\windows-agent-portable\DeviceStateConsoleAgent `
  -ReportPath .\release\windows-agent-portable\realtime-report.json
```

如果只想在当前源码树里验证最新 backend/collector 行为，也可以不传 `-BundleRoot`，脚本会先自动准备一个 `.codex-artifacts/verify-agent-bundle-latest/`。

期望输出：

- 实时模式验证通过
- `toggleObserved = true`
- `autoRevertObserved = true`
- 常态间隔 `15`
- 实时间隔 `5`
- `release/windows-agent-portable/realtime-report.json`

## Step 6b: Verify Explicit Cloud Push

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-cloud-push.ps1 `
  -BundleRoot .\release\windows-agent-portable\DeviceStateConsoleAgent `
  -ReportPath .\release\windows-agent-portable\cloud-push-report.json
```

不传 `-BundleRoot` 时，也会自动准备最新的 backend 验证 bundle。

期望输出：

- backend 不会在未点击推送前自动向中枢发送展示配置
- 显式调用 `/api/cloud/push` 后，中枢会收到 `enabledMetrics`、`enabledDeviceIds`、`instanceMetricConfig`
- `noImplicitPushObserved = true`
- `pushSucceeded = true`
- `release/windows-agent-portable/cloud-push-report.json`

WinUI 侧还应同步观察到：

- 推送按钮文案会根据状态在“首次推送展示配置”“推送最新展示配置”“重新推送展示配置”“重试推送展示配置”之间变化
- 推送成功后，运行控制区会立即回显最近一次推送成功时间
- 推送失败后，运行控制区会立即回显失败时间与错误原因，而不是必须等待下一次轮询

## Step 6c: Verify Local Config Affects Ingest Payload

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-local-config-payload.ps1 `
  -BundleRoot .\release\windows-agent-portable\DeviceStateConsoleAgent `
  -ReportPath .\release\windows-agent-portable\local-config-payload-report.json
```

不传 `-BundleRoot` 时，也会自动准备最新的 backend 验证 bundle。

期望输出：

- 本地配置会直接影响 collector 实际上报的 `POST /api/agent/ingest` payload
- 关闭的类别会被清零或省略
- 选中的 CPU 实例会过滤 `cpuPackages`
- 选中的磁盘实例会过滤 `disks`
- `payloadMatched = true`
- `release/windows-agent-portable/local-config-payload-report.json`

## Step 6d: Verify Cloud-Pending Persistence

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-cloud-pending-persist.ps1 `
  -BundleRoot .\release\windows-agent-portable\DeviceStateConsoleAgent `
  -ReportPath .\release\windows-agent-portable\cloud-pending-persist-report.json
```

不传 `-BundleRoot` 时，也会自动准备最新的 backend 验证 bundle。

期望输出：

- 本地展示配置改动后，backend state 中 `cloudConfigPending = true`
- backend 重启后，`cloudConfigPending` 仍然恢复为 `true`
- 显式推送成功后，`cloudConfigPending = false`
- `syncStateWritten = true`
- `release/windows-agent-portable/cloud-pending-persist-report.json`

WinUI 侧还应同步观察到：

- 本地改动会先即时影响 agent 采集与发送，但网页/客户端展示仍保持旧状态
- 运行控制区会显示“待推送”或“待首推送”，并明确提示只有显式推送后网页/客户端才会更新展示类别
- 若关闭“允许将展示配置同步到中枢”，运行控制区会明确提示本地已生效，但当前不会把展示配置推送到中枢
- 类别开启后，用户还可以继续按具体指标勾选要发送的数据，例如只保留 `CPU 使用率`、关闭 `CPU 温度`
- 这些具体指标勾选会直接映射到本地配置里的 `enabledMetrics`
- 对某个 CPU / 磁盘 / 网卡 / 显卡实例点击“细化指标”后，还可以继续只保留这个实例的部分指标；这些勾选会直接映射到本地配置里的 `instanceMetricConfig`

补充执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-cloud-pending-boundary.ps1 `
  -BundleRoot .\release\windows-agent-portable\DeviceStateConsoleAgent `
  -ReportPath .\release\windows-agent-portable\cloud-pending-boundary-report.json
```

额外期望输出：

- 仅修改 `sampling` 或 `autoRestartCollector` 这类运行时配置后，`cloudConfigPending` 仍保持 `false`
- 仅运行时配置改动不会提前生成 `agent-ui.sync-state.json`
- `release/windows-agent-portable/cloud-pending-boundary-report.json`

补充执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-instance-metric-config.ps1 `
  -BundleRoot .\release\windows-agent-portable\DeviceStateConsoleAgent `
  -ReportPath .\release\windows-agent-portable\instance-metric-config-report.json
```

额外期望输出：

- `payloadMatched = true`
- 选中的 CPU 实例若被配置为“实例指标全关”，实例级 CPU 指标不会继续按原样发送
- 选中的磁盘实例若只保留 `diskUsage`，容量字段仍保留，而读写速率被正确清零
- `release/windows-agent-portable/instance-metric-config-report.json`

## Step 6e: Verify Parent-Exit Cleanup

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-parent-exit.ps1 `
  -BundleRoot .\release\windows-agent-portable\DeviceStateConsoleAgent `
  -ReportPath .\release\windows-agent-portable\parent-exit-report.json
```

不传 `-BundleRoot` 时，也会自动准备最新的 backend 验证 bundle。

期望输出：

- backend 被强制退出后，collector 不会残留为孤儿进程
- `collectorStarted = true`
- `backendKilled = true`
- `collectorExitedWithBackend = true`
- `release/windows-agent-portable/parent-exit-report.json`

## Step 6f: Verify Viewer-Driven Realtime

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-viewer-realtime.ps1 `
  -BundleRoot .\release\windows-agent-portable\DeviceStateConsoleAgent `
  -ReportPath .\release\windows-agent-portable\viewer-realtime-report.json
```

同样地，不传 `-BundleRoot` 时脚本会先自动准备最新的 backend 验证 bundle。

期望输出：

- 观看态驱动的实时模式验证通过
- `controlStreamConnected = true`
- `controlStreamEventObserved = true`
- `controlStreamStableBeyondTimeoutWindow = true`
- `viewerDrivenRealtimeObserved = true`
- `viewerDrivenRealtimeSource = viewer`
- `viewerDrivenRealtimeReverted = true`
- `release/windows-agent-portable/viewer-realtime-report.json`

## Step 6g: Verify Viewer Hold Window

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-viewer-realtime-hold.ps1 `
  -BundleRoot .\release\windows-agent-portable\DeviceStateConsoleAgent `
  -ReportPath .\release\windows-agent-portable\viewer-realtime-hold-report.json
```

不传 `-BundleRoot` 时也会自动准备最新的 backend 验证 bundle。

期望输出：

- Viewer 实时保持窗口验证通过
- `holdWindowRetainedAfterDisable = true`
- `holdExtendedBeyondServerTtl = true`
- `holdExtendedPastDisablePoint = true`
- `viewerDrivenRealtimeReverted = true`
- `release/windows-agent-portable/viewer-realtime-hold-report.json`

## Step 6h: Verify Control-Stream Fallback

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-control-stream-fallback.ps1 `
  -BundleRoot .\release\windows-agent-portable\DeviceStateConsoleAgent `
  -ReportPath .\release\windows-agent-portable\control-stream-fallback-report.json
```

不传 `-BundleRoot` 时也会自动准备最新的 backend 验证 bundle。

期望输出：

- 控制流回退验证通过
- `controlStreamConnected = false`
- `controlStreamEventObserved = false`
- `fallbackPollDrivenRealtimeObserved = true`
- `fallbackRealtimeReverted = true`
- `release/windows-agent-portable/control-stream-fallback-report.json`

## Step 7: Manual Acceptance

按以下文档逐项验收：

- `deploy/windows-agent-acceptance-checklist.md`

至少记录：

- 便携包首启结果
- setup 安装结果
- 配置写入位置
- WinUI 是否正确显示当前模式、推荐顺序卡片，以及本地配置/同步状态/诊断日志路径
- WinUI 关闭后 backend/collector 是否一并退出
- WinUI 若被异常结束，backend/collector 是否也会因为父进程消失而自动退出
- WinUI 关闭时是否优先经由本地 shutdown 接口完成退出
- 采集器异常退出后本地 backend 是否自动重启
- 采集器错误时最近异常分类是否正确显示
- 实时模式切换后状态区与生效上传间隔是否同步变化
- 中枢实时控制通道在 WinUI 中是否能区分显示“已连通”“保活正常”“回退轮询”“待建链”
- 临时实时模式到期后是否自动回落到常态上传
- 网页正在查看设备时，Windows agent 是否自动进入实时模式；关闭查看后是否回落
- 本地展示配置改动但尚未推送时，WinUI 是否提示“待推送”；重启后是否仍能恢复该状态
- 推送至云端后网页/客户端展示是否变化
- setup 卸载时，是否明确询问要不要删除 `%LocalAppData%\DeviceStateConsoleAgent\`
- 选择“否”后，本地配置是否保留；选择“是”后，本地配置目录是否被一并删除

## Step 8: Aggregate Release Readiness

如果你已经有：

- `verify-windows-build-prereqs.ps1` 的报告
- `verify-windows-agent-external-publish-package.ps1` 的报告
- `verify-windows-agent-suite.ps1` 的报告
- `verify-windows-agent-setup-lifecycle.ps1` 的报告

可继续执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-release-readiness.ps1 `
  -RequirePortableSuite `
  -RequireSetupLifecycle `
  -ReportPath .\release\windows-agent-release-readiness-report.json
```

期望输出：

- `Windows release readiness verification passed.`
- `release/windows-agent-release-readiness-report.json`
- 报告中 `status.externalPublishPackageVerified = true`
- 报告中 `status.portableSuiteVerified = true`
- 报告中 `status.portableArtifactStateVerified = true`
- 报告中 `status.installedArtifactStateVerified = true`
- 报告中 `status.localArtifactStateVerified = true`
- 报告中 `evidence.*` 会指出当前已经收集到的自动化证据来源
- 报告中 `remediation.*` 会指出当前工具链阻塞项、建议步骤和推荐命令
- 报告中 `status.setupLifecycleVerified = true`
- 报告中 `status.issueDiagnosisVerified = true`
- 报告中 `status.controlStreamVerified = true`
- 若当前机器缺少 WinUI / Inno Setup 工具链，报告中可能仍会出现 `blockedByToolchain = true`

## Evidence to Keep

- `release/windows-agent-portable/bundle-report.json`
- `release/windows-agent-setup/setup-template-report.json`
- `release/windows-agent-setup/setup-generated-report.json`
- `release/windows-agent-portable/autorestart-report.json`
- `release/windows-agent-portable/issue-category-report.json`
- `release/windows-agent-portable/cloud-push-report.json`
- `release/windows-agent-portable/cloud-pending-persist-report.json`
- `release/windows-agent-portable/local-config-payload-report.json`
- `release/windows-agent-portable/parent-exit-report.json`
- `release/windows-agent-portable/realtime-report.json`
- `release/windows-agent-portable/viewer-realtime-report.json`
- `release/windows-agent-portable/viewer-realtime-hold-report.json`
- `release/windows-agent-portable/control-stream-fallback-report.json`
- `release/windows-agent-portable/control-stream-keepalive-report.json`
- `release/windows-agent-release-readiness-report.json`
- 便携包 zip
- setup 安装包
- 手工验收截图或记录
- 最终版本号

## Step 9: Export Human-Readable Delivery Summary

当你需要给测试、交付或另一台构建机一份便于阅读的总结时，执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\export-windows-agent-delivery-summary.ps1 `
  -BuildPrereqsReportPath .\release\windows-build-prereqs-report.json `
  -ReleaseReadinessReportPath .\release\windows-agent-release-readiness-report.json `
  -ExternalPublishPackageReportPath .\release\windows-agent-external-publish-package\external-publish-package-report.json `
  -OutputPath .\release\windows-agent-delivery-summary.md
```

期望输出：

- `release/windows-agent-delivery-summary.md`
- 摘要中能直接看到：
  - 是否仍被 `.NET SDK 8` 或 `Inno Setup 6` 阻塞
  - portable / setup 的当前就绪状态
  - 外部 publish 打包、portable suite、setup lifecycle、local artifact state、control stream 的验证状态
  - 当前阻塞项、推荐命令与下一步操作

如果你只是在当前机器上快速导出默认摘要，也可以直接运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\export-windows-agent-delivery-summary.ps1
```

## Step 10: Export Objective Audit

如果你需要一份更贴近原始目标本身的检查结果，而不是只看构建/验收报告，可以继续执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\export-windows-agent-objective-audit.ps1 `
  -BuildPrereqsReportPath .\release\windows-build-prereqs-report.json `
  -ReleaseReadinessReportPath .\release\windows-agent-release-readiness-report.json `
  -SuiteSummaryPath .\release\windows-agent-suite\suite-summary.json `
  -SetupLifecycleReportPath .\release\windows-agent-setup\setup-lifecycle-report.json `
  -OutputPath .\release\windows-agent-objective-audit.md
```

期望输出：

- `release/windows-agent-objective-audit.md`
- 摘要中会按原始目标逐条给出 `Verified`、`Partially verified`、`Blocked by toolchain` 或 `Not verified`
- 摘要中会指向对应的 build prereqs / release readiness / suite / setup lifecycle 报告来源
