# Windows Agent Acceptance Checklist

## Scope

适用于两种交付形态：

- 便携包
- setup 安装包

## Portable

1. 便携目录包含以下关键文件：
   - `DeviceStateConsoleAgent.WinUI.exe`
   - `backend/windows-agent-backend.exe`
   - `backend/device-state-console-agent.exe`
   - `backend/windows-hardware/`
2. 运行：
   - `powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-bundle.ps1 -BundleRoot <bundle-root>`
   - 报告中 `backendSmokeTest.configFileExists = true`
   - 报告中 `backendSmokeTest.diagnosticsFileExists = true`
   - 首次启动前，`sync-state` 尚未生成；本地展示配置改动后，报告中 `backendSmokeTest.syncStateFileExists = true`
3. 首次启动 WinUI 后：
   - 未填完整连接信息前，“启动采集器”“推送至云端”按钮保持禁用
   - 填好 `Server URL`、`Agent Secret`、`Device ID` 后，按钮转为可用
   - 页面能明确显示当前是 `便携模式`
   - 页面能看到“推荐顺序”工作流卡片，以及 `STEP 1` 到 `STEP 4` 的引导
   - 页面能看到当前 `configPath`、`syncStatePath`、`diagnosticsPath` 都位于便携目录
   - 页面能直接区分配置文件、同步状态文件、诊断日志当前是“已生成”还是“尚未生成”
4. 关闭并重开 WinUI：
   - 配置仍保存在便携目录中的 `agent-ui.config.json`
   - 关闭 WinUI 时，本地 backend 会优先走优雅关闭接口，再退出采集器
   - 若手动结束 WinUI 进程，本地 backend 会因父进程消失而自动退出，collector 不会残留
5. 启动采集器后：
   - 本地状态区能看到连接状态和最近日志
- 若中枢实时控制通道可用，状态区可看到“已连通”；若暂不可用，状态区会提示已回退到低频轮询
- 若控制流断开，状态区还能直接看到最近一次断开时间和断开原因，且原因应为可读中文而不是内部错误码
- 若控制流表面连通但长时间没有新快照，状态区会进入 `recovering` 语义，明确表示 backend 已主动取消旧连接并开始重连
- 控制流状态会以 InfoBar 分级显示：已连通为成功态，主动重连中与已回退轮询为警告态，首次待建链为信息态
- 若当前仅收到保活快照而没有新的观看态变化，状态区会显示 `connected-keepalive` 语义，而不是误报断线
- 控制流状态区还应显示问题类别、建议操作和链路健康度，帮助区分是配置问题、中枢能力缺失、网络异常、服务端主动断开，还是 Windows 端近期频繁发生静默超时重连
- 控制流诊断区还应显示主动重连次数，以及最近一次主动重连时间
   - 若开启“采集器异常退出后自动重启”，采集器异常退出后状态会短暂进入等待重启，并恢复拉起
   - 若采集器发生上传失败或采集失败，状态区可看到最近异常分类与时间
6. 执行组件探测后：
   - CPU 实例、磁盘实例和网卡实例列表可见
   - 开关变更会写入本地配置
7. 按指标记录验证：
   - CPU、内存、磁盘、网络、显卡类别下都可以继续勾选具体指标，而不只是整类开关
   - 例如可以只保留 `CPU 使用率`、关闭 `CPU 温度`，或只保留 `网络累计流量`
   - 这些勾选会即时写回本地配置中的 `enabledMetrics`
   - 重新打开 WinUI 后，具体指标勾选状态仍能恢复
8. 按实例细化指标验证：
   - 对某个 CPU / 磁盘 / 网卡 / 显卡实例点击“细化指标”后，可以继续只保留这个实例的部分指标
   - 这些勾选会即时写回本地配置中的 `instanceMetricConfig`
   - 重新打开 WinUI 后，实例级指标勾选状态仍能恢复
9. 点击“推送至云端”后：
   - 中枢收到 `POST /api/agent/device-config`
   - 网页/客户端展示类别按新配置变化
10. 展示配置待推送状态验证：
   - 在本地修改会影响展示配置的类别或实例开关后，WinUI 显示“待推送”或“待首推送”
   - “推送至云端”按钮文案会随状态变化，例如“首次推送展示配置”“推送最新展示配置”“重新推送展示配置”
   - 运行控制区会明确提示当前为什么需要推送，或为什么当前不需要推送
   - 若关闭“允许将展示配置同步到中枢”，WinUI 会明确提示“本地已生效，但网页/客户端不会更新展示类别”
   - 若只修改采样频次、实时模式或“采集器异常退出后自动重启”这类运行时配置，WinUI 不应误报“待推送”
   - 重启 WinUI / backend 后，该待推送状态仍可恢复
   - `powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-cloud-pending-persist.ps1 -BundleRoot <bundle-root>`
   - 报告中 `pendingAfterLocalChange = true`
   - 报告中 `pendingRestoredAfterRestart = true`
   - 报告中 `pendingClearedAfterPush = true`
   - `powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-cloud-pending-boundary.ps1 -BundleRoot <bundle-root>`
   - 报告中 `pendingAfterRuntimeChange = false`
   - 报告中 `syncStateStillMissing = true`
11. 自动重启验证：
   - `powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-autorestart.ps1 -BundleRoot <bundle-root>`
   - 报告中 `restartCount >= 1`
   - 报告中 `lastExitCode = 7`
   - 报告中 `diagnosticsObserved = true`
12. 异常分类验证：
   - `powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-issue-category.ps1 -BundleRoot <bundle-root>`
   - 报告中 `issueObserved = true`
   - 报告中 `issueCategory = upload`
   - 报告中 `issueCount >= 1`
   - 报告中 `recoveryObserved = true`
   - 报告中 `issueRecoveredAt` 非空
   - 报告中 `recoveredConnectionStatus = connected`
13. 显式云端推送验证：
   - `powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-cloud-push.ps1 -BundleRoot <bundle-root>`
   - 报告中 `noImplicitPushObserved = true`
   - 报告中 `pushSucceeded = true`
   - mock 中枢收到 `enabledMetrics`、`enabledDeviceIds`、`instanceMetricConfig`
   - `enabledMetrics` 中会准确反映 WinUI 里当前勾选的具体指标，而不是只反映类别是否开启
   - 推送成功后，WinUI 会立即回显最近一次推送成功时间，而不是必须等待下一次轮询
   - 若推送失败，WinUI 会立即回显失败时间与错误原因，并允许重试推送
14. 本地配置影响上报 payload 验证：
   - `powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-local-config-payload.ps1 -BundleRoot <bundle-root>`
   - 报告中 `payloadMatched = true`
   - 报告中可证明关闭的类别未继续上报，未勾选的具体指标被正确清零或省略，选中的 CPU 实例与磁盘实例被正确过滤
15. 实例级指标影响上报 payload 验证：
   - `powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-instance-metric-config.ps1 -BundleRoot <bundle-root>`
   - 报告中 `payloadMatched = true`
   - 报告中 `cpuInstanceMetricsCleared = true`
   - 报告中 `diskUsagePreserved = true`
   - 报告中 `diskRateCleared = true`
16. 实时模式验证：
   - `powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-realtime-mode.ps1 -BundleRoot <bundle-root>`
   - 报告中 `toggleObserved = true`
   - 报告中 `autoRevertObserved = true`
   - 报告中常态间隔为 `15`，实时间隔为 `5`
17. 父进程异常退出清理验证：
   - `powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-parent-exit.ps1 -BundleRoot <bundle-root>`
   - 报告中 `collectorStarted = true`
   - 报告中 `backendExitedAfterParent = true`
   - 报告中 `collectorExitedWithBackend = true`
18. 观看态驱动的实时模式验证：
   - `powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-viewer-realtime.ps1 -BundleRoot <bundle-root>`
   - 报告中 `controlStreamConnected = true`
   - 报告中 `controlStreamEventObserved = true`
   - 报告中 `controlStreamStableBeyondTimeoutWindow = true`
   - 报告中 `viewerDrivenRealtimeObserved = true`
   - 报告中 `viewerDrivenRealtimeSource = viewer`
   - 报告中 `viewerDrivenRealtimeReverted = true`
19. Viewer 保持窗口验证：
   - `powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-viewer-realtime-hold.ps1 -BundleRoot <bundle-root>`
   - 报告中 `holdWindowRetainedAfterDisable = true`
   - 报告中 `holdExtendedBeyondServerTtl = true`
   - 报告中 `holdExtendedPastDisablePoint = true`
   - 报告中 `viewerDrivenRealtimeReverted = true`
   - WinUI 状态区应能明确显示 `Viewer 实时保持时长` 已生效，而不是在 viewer 刚离开后立刻切回常态
20. 控制流回退验证：
   - `powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-control-stream-fallback.ps1 -BundleRoot <bundle-root>`
   - 报告中 `controlStreamConnected = false`
   - 报告中 `controlStreamEventObserved = false`
   - 报告中 `fallbackPollDrivenRealtimeObserved = true`
   - 报告中 `fallbackRealtimeReverted = true`
21. 控制流保活验证：
   - `powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-control-stream-keepalive.ps1 -BundleRoot <bundle-root>`
   - 报告中 `initialConnectedCommentObserved = true`
   - 报告中 `keepaliveFramesObserved >= 2`
   - 报告中 `keepaliveFrameIntervalsMs` 至少包含一段接近服务端保活周期的间隔
   - WinUI 不应因为只有保活帧而误显示为“控制流已断开”
22. 控制流静默超时后主动重连验证：
   - `powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-control-stream-recovering.ps1 -BundleRoot <bundle-root>`
   - 报告中 `recoveringObserved = true`
   - 报告中 `reconnectCountObserved >= 1`
   - 报告中 `staleDiagnosticObserved = true`
   - 报告中 `secondStreamConnectionObserved = true`
   - 报告中 `reconnectedAfterRecovery = true`
   - WinUI 应能把这类情况表达为 `recovering` 语义，而不是普通断线

## Setup

1. 安装包能成功安装到：
   - `Program Files\DeviceStateConsoleAgent`
2. 安装后目录结构仍保持：
   - `DeviceStateConsoleAgent.WinUI.exe`
   - `backend/windows-agent-backend.exe`
   - `backend/device-state-console-agent.exe`
   - `backend/windows-hardware/`
   - 开始菜单存在 `DeviceStateConsoleAgent` 快捷方式
3. 首次启动 WinUI 后：
   - `agent-ui.config.json` 写入 `%LocalAppData%\DeviceStateConsoleAgent\`
   - 不写入安装目录
   - 页面能明确显示当前是 `安装模式`
   - 页面能看到当前 `configPath`、`syncStatePath`、`diagnosticsPath` 位于 `%LocalAppData%\DeviceStateConsoleAgent\`
   - 页面能直接区分配置文件、同步状态文件、诊断日志当前是“已生成”还是“尚未生成”
   - 页面首启引导会明确说明二进制在安装目录，而本地连接信息与同步状态写入 `LocalAppData`
   - 可执行 `powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-installed-layout.ps1 -RequireConfigArtifacts`
   - 报告中 `configFileExists = true`
   - 报告中 `diagnosticsFileExists = true`
   - 报告中 `installRootHasNoLocalConfig = true`
4. 关闭 WinUI 时：
   - 本地 backend 退出
   - backend 管理的采集器子进程一并退出
   - 优先走本地 shutdown 接口，而不是只依赖强制结束进程树
   - 若直接结束 WinUI 进程，backend 也会识别父进程消失并自动退出
5. 在安装模式下开启自动重启后：
   - 采集器异常退出会由本地 backend 自动重启
   - 状态区可看到最近一次退出和自动重启次数
   - 可定位到本地 backend 诊断日志路径，并看到退出记录
   - 可看到最近异常分类，例如 `upload`、`slow_metrics`
6. 重启机器后再次打开应用：
   - 仍能读取上次保存的连接信息和本地记录配置
7. 卸载后：
   - 安装目录被移除
   - 开始菜单快捷方式被移除
   - 卸载流程会明确询问是否删除 `%LocalAppData%\DeviceStateConsoleAgent\`
   - 若走自动化验证链，也可通过卸载参数显式指定：
   - `/uninstallconfig=retain`
   - `/uninstallconfig=delete`
   - 选择“否”后，本地配置与待推送状态保留
   - 选择“是”后，本地配置目录被一并删除
   - 若选择“否”，执行 `powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-uninstall-result.ps1 -ConfigExpectation retained`
   - 报告中 `installRootRemoved = true`
   - 报告中 `configRootStateMatchesExpectation = true`
   - 若选择“是”，执行 `powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-uninstall-result.ps1 -ConfigExpectation deleted`
   - 报告中 `installRootRemoved = true`
   - 报告中 `configRootStateMatchesExpectation = true`
8. 安装模板静态策略验证：
   - `powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-setup-template.ps1`
   - 报告中安装目录仍为 `Program Files\DeviceStateConsoleAgent`
   - 报告中本地配置目录仍为 `%LocalAppData%\DeviceStateConsoleAgent\`
   - 报告中 `startMenuShortcutConfigured = true`
   - 报告中 `desktopShortcutTaskConfigured = true`
   - 报告中卸载时仍存在“是否删除本地配置目录”的确认逻辑
9. 生成版 `.iss` 校验：
   - `powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-setup-generated.ps1 -OutputDir <setup-output-dir>`
   - 报告中 `windows-agent-setup.generated.iss` 已生成
   - 报告中便携包路径、输出目录和版本号都已被正确替换
   - 报告中 `startMenuShortcutRetained = true`
   - 报告中 `desktopShortcutTaskRetained = true`
   - 报告中卸载时删除本地配置的确认逻辑仍保留在生成版 `.iss` 中
   - 报告中 `bundleAssets.frontendExeExists = true`
   - 报告中 `bundleAssets.backendExeExists = true`
   - 报告中 `bundleAssets.collectorExeExists = true`
   - 报告中 `bundleAssets.hardwareLhmExists = true`
   - 报告中 `bundleAssets.hardwarePawnInstallerExists = true`
10. 安装后目录与本地配置路径验证：
   - `powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-installed-layout.ps1`
   - 报告中 `frontendExeExists = true`
   - 报告中 `backendExeExists = true`
   - 报告中 `collectorExeExists = true`
   - 报告中 `uninstallerExists = true`
   - 报告中 `startMenuShortcutExists = true`
   - 若已首启应用，再执行 `powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-installed-layout.ps1 -RequireConfigArtifacts`
   - 报告中 `backendSmokeTest.passed = true`
   - 报告中 `backendSmokeTest.configFileExistsReported = true`
   - 报告中 `backendSmokeTest.diagnosticsFileExistsReported = true`
   - 若同步状态文件已生成，报告中 `backendSmokeTest.syncStateFileExistsReported = true`
   - 若要进一步验证安装模式下“本地展示配置改动后 sync-state 会落盘”，可执行 `powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-installed-layout.ps1 -RequireConfigArtifacts -RequireSyncStateAfterDisplayChange`
   - 报告中 `backendSmokeTest.syncStateCreatedAfterDisplayChange = true`
   - 报告中 `backendSmokeTest.syncStateFileExistsReportedAfterDisplayChange = true`
   - 报告中 `backendSmokeTest.cloudConfigPendingAfterDisplayChange = true`
11. 卸载结果验证：
   - `powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-uninstall-result.ps1 -ConfigExpectation retained`
   - 或 `powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-uninstall-result.ps1 -ConfigExpectation deleted`
   - 报告中 `installRootRemoved = true`
   - 报告中 `startMenuShortcutRemoved = true`
   - 报告中 `uninstallRegistryEntryRemoved = true`
   - 报告中 `configRootStateMatchesExpectation = true`
12. setup 生命周期总览验证：
   - `powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-setup-lifecycle.ps1 -RequireInstalledLayout -RequireUninstallRetained`
   - 若也验证了“选择是后删除配置”，可改为附加 `-RequireUninstallDeleted`
   - 报告中 `summary.passed = true`
   - 报告中 `status.installedArtifactStateVerified = true`
   - 报告中 `status.localArtifactStateVerified = true`
13. 真实 setup 安装器自动化验证：
   - `powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-setup-execution.ps1 -SetupExePath .\release\windows-agent-setup\DeviceStateConsoleAgent-setup.exe -OutputDir .\release\windows-agent-setup-execution`
   - 该脚本必须在管理员 PowerShell 会话中执行
   - 若验证机不是全新环境，才使用 `-ForceCleanup`
   - 报告中 `checks.installCompleted = true`
   - 报告中 `checks.installedLayoutVerified = true`
   - 报告中 `checks.uninstallRetainedVerified = true`
   - 报告中 `checks.uninstallDeletedVerified = true`
   - 报告中 `checks.lifecycleVerified = true`
   - 脚本成功后，`release/windows-agent-release-readiness-report.json`、`release/windows-agent-objective-audit.md`、`release/windows-agent-delivery-summary.md` 也会自动刷新

## Build-Machine Validation

1. 在有 WinUI 工具链的机器上执行：
   - `powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-build-prereqs.ps1 -RequireAll`
2. 在有 WinUI 工具链的机器上执行：
   - `dotnet publish windows-agent/DeviceStateConsoleAgent.WinUI/DeviceStateConsoleAgent.WinUI.csproj -c Release -p:Platform=x64`
3. 在有 Inno Setup 的机器上执行：
   - `powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-setup-template.ps1`
4. 在有 Inno Setup 的机器上执行：
   - `powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-setup-generated.ps1 -OutputDir .\release\windows-agent-setup`
5. 在有 Inno Setup 的机器上执行：
   - `powershell -ExecutionPolicy Bypass -File .\deploy\build-windows-agent-setup.ps1`
6. 验证产出：
   - 便携目录结构正确
   - `setup.exe` 可安装、可启动、可卸载
7. 在管理员验证机上执行：
   - `powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-setup-execution.ps1 -SetupExePath .\release\windows-agent-setup\DeviceStateConsoleAgent-setup.exe -OutputDir .\release\windows-agent-setup-execution`
