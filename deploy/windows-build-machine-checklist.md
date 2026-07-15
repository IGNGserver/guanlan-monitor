# Windows 构建机准备清单

适用目标：

- 产出 WinUI 3 前端发布目录
- 组装 Windows 便携包
- 产出 `setup.exe` 或至少生成 `windows-agent-setup.generated.iss`

## 路线选择

可以按两种方式准备构建环境：

1. 同机完整出包
   这台机器同时负责 `dotnet publish`、Go 二进制构建、便携包组装和 `setup.exe` 编译。
2. 分机出包
   一台 WinUI 发布机负责 `dotnet publish`，另一台打包机负责 Go 构建、便携包组装和 Inno Setup 编译。

如果当前机器缺少 `.NET SDK` 或 WinUI 工具链，优先采用“分机出包”路线。

## 必装组件

### 便携包构建机

- `.NET SDK 8`
- `Windows App SDK 1.6.x`
- `Go 1.24+`

### setup 安装包构建机

- 便携包构建机所需全部组件
- `Inno Setup 6`

## 最低源码要求

当前仓库中的 WinUI 工程应满足：

- 工程文件存在：
  `windows-agent\DeviceStateConsoleAgent.WinUI\DeviceStateConsoleAgent.WinUI.csproj`
- `TargetFramework` 为：
  `net8.0-windows10.0.19041.0`
- `Microsoft.WindowsAppSDK` 包版本存在

## Step 1：检查当前机器是否满足前置条件

先执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-build-prereqs.ps1 `
  -ReportPath .\release\windows-build-prereqs-report.json
```

重点关注报告中的：

- `readiness.portableBuildReady`
- `readiness.setupBuildReady`
- `remediation.portableBuildBlockedBy`
- `remediation.setupBuildBlockedBy`
- `remediation.nextSteps`
- `remediation.recommendedCommands`

如果 `portableBuildReady = false`，不要直接继续便携包构建，先处理阻塞项。

如果 `setupBuildReady = false`，可以先构建便携包，或先生成 `.iss`，再去有 `ISCC.exe` 的机器继续。

## Step 2：验证工具安装结果

建议在构建机手动执行：

```powershell
dotnet --version
go version
```

如果要直接编译 `setup.exe`，还应确认：

```powershell
ISCC.exe /?
```

如果 `ISCC.exe` 不在 PATH，也可以检查这两个默认路径之一：

- `C:\Program Files (x86)\Inno Setup 6\ISCC.exe`
- `C:\Program Files\Inno Setup 6\ISCC.exe`

## Step 3：同机完整出包

### 3.1 组装便携包

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\build-windows-agent-portable.ps1 -Zip
```

默认输出：

- `release\windows-agent-portable\DeviceStateConsoleAgent\`
- `release\windows-agent-portable\DeviceStateConsoleAgent-portable.zip`

### 3.2 验证便携包

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-bundle.ps1 `
  -BundleRoot .\release\windows-agent-portable\DeviceStateConsoleAgent `
  -ReportPath .\release\windows-agent-portable\bundle-report.json
```

### 3.3 构建 setup 安装包

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\build-windows-agent-setup.ps1 `
  -PortableBundleDir .\release\windows-agent-portable\DeviceStateConsoleAgent `
  -OutputDir .\release\windows-agent-setup `
  -Version 0.1.0
```

期望输出：

- `release\windows-agent-setup\windows-agent-setup.generated.iss`
- 如果本机已安装 Inno Setup，还应产出 `setup.exe`

## Step 4：分机出包

### 4.1 在 WinUI 发布机执行 dotnet publish

建议先在具备 WinUI 工具链的机器上执行：

```powershell
dotnet publish .\windows-agent\DeviceStateConsoleAgent.WinUI\DeviceStateConsoleAgent.WinUI.csproj `
  -c Release `
  -p:Platform=x64 `
  -o C:\artifacts\DeviceStateConsoleAgent.WinUI\publish
```

确认发布目录内存在：

- `DeviceStateConsoleAgent.WinUI.exe`

建议进一步执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-winui-publish.ps1 `
  -PublishDir C:\artifacts\DeviceStateConsoleAgent.WinUI\publish `
  -ReportPath .\release\windows-winui-publish-report.json
```

期望输出：

- `WinUI publish directory looks valid.`
- 报告中 `passed = true`
- 报告中 `frontendExeExists = true`
- 报告中 `frontendDllExists = true`
- 报告中 `depsJsonExists = true`
- 报告中 `runtimeConfigExists = true`

### 4.2 在打包机组装便携包

将发布目录带到打包机后执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\build-windows-agent-portable.ps1 `
  -WinUIPublishDir C:\artifacts\DeviceStateConsoleAgent.WinUI\publish `
  -Zip
```

这条路线不要求打包机具备 `dotnet publish` 能力，但仍然需要 Go 来构建 backend 和 collector，除非你显式改为复用预编译二进制。

如果你想先验证“外部 WinUI 发布目录 -> 便携包组装”这条路径本身是通的，可以执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-external-publish-package.ps1 `
  -OutputDir .\release\windows-agent-external-publish-package `
  -ReportPath .\release\windows-agent-external-publish-package\external-publish-package-report.json
```

这条验证会：

- 先校验外部 WinUI publish 目录结构
- 再调用 `build-windows-agent-portable.ps1 -WinUIPublishDir ...`
- 最后校验产出的便携包目录至少包含前端、backend、collector 和硬件资产

如果你已经有一份真实的 WinUI 发布目录，也可以直接传入：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-external-publish-package.ps1 `
  -PublishDir C:\artifacts\DeviceStateConsoleAgent.WinUI\publish `
  -OutputDir .\release\windows-agent-external-publish-package `
  -ReportPath .\release\windows-agent-external-publish-package\external-publish-package-report.json
```

如果这台打包机也具备 Go 工具链，并且你希望验证“真实 PublishDir + 现场重建 Go backend/collector”这条更接近最终交付的路径，可以继续加上：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-external-publish-package.ps1 `
  -PublishDir C:\artifacts\DeviceStateConsoleAgent.WinUI\publish `
  -UseGoBuild `
  -OutputDir .\release\windows-agent-external-publish-package `
  -ReportPath .\release\windows-agent-external-publish-package\external-publish-package-report.json
```

### 4.3 在 setup 机器生成安装包

如果打包机没有 Inno Setup，可以先执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\build-windows-agent-setup.ps1 `
  -PortableBundleDir .\release\windows-agent-portable\DeviceStateConsoleAgent `
  -OutputDir .\release\windows-agent-setup `
  -Version 0.1.0
```

若本机缺少 `ISCC.exe`，脚本会只生成：

- `release\windows-agent-setup\windows-agent-setup.generated.iss`

再把这个输出目录带到安装了 Inno Setup 6 的机器上继续编译。

## Step 5：建议的最小验收顺序

建议至少按这个顺序做：

1. `verify-windows-build-prereqs.ps1`
2. `build-windows-agent-portable.ps1`
3. `verify-windows-agent-bundle.ps1`
4. `verify-windows-agent-suite.ps1`
5. `build-windows-agent-setup.ps1`
6. `verify-windows-agent-setup-template.ps1`
7. `verify-windows-agent-setup-generated.ps1`

如果已经在真实安装机完成安装和卸载流程，再继续：

1. `verify-windows-agent-installed-layout.ps1`
2. `verify-windows-agent-uninstall-result.ps1`
3. `verify-windows-agent-setup-lifecycle.ps1`
4. `verify-windows-agent-release-readiness.ps1`
5. `export-windows-agent-delivery-summary.ps1`

如果你希望把真实安装、保留配置卸载、再次安装、删除配置卸载整条链一次跑完，建议直接在管理员验证机上执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\verify-windows-agent-setup-execution.ps1 `
  -SetupExePath .\release\windows-agent-setup\DeviceStateConsoleAgent-setup.exe `
  -OutputDir .\release\windows-agent-setup-execution
```

这一步会自动产出：

- `setup-template-report.json`
- `setup-generated-report.json`
- `installed-layout-report.json`
- `uninstall-retained-report.json`
- `uninstall-deleted-report.json`
- `windows-agent-setup-lifecycle-report.json`
- `windows-agent-setup-execution-report.json`

最后建议再导出一份便于交接的摘要：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\export-windows-agent-delivery-summary.ps1 `
  -BuildPrereqsReportPath .\release\windows-build-prereqs-report.json `
  -ReleaseReadinessReportPath .\release\windows-agent-release-readiness-report.json `
  -ExternalPublishPackageReportPath .\release\windows-agent-external-publish-package\external-publish-package-report.json `
  -OutputPath .\release\windows-agent-delivery-summary.md
```

这一步特别适合“WinUI 发布机 -> 打包机 -> 安装验证机”的分机路线，因为它能把：

- 工具链是否齐全
- 当前缺的到底是 WinUI publish、setup 编译还是安装验证
- 哪些自动化证据已经齐全
- 下一步推荐命令

统一收敛到一份 Markdown 里，减少口头交接时的信息丢失。

## 当前机器的判断方式

不要把某一次会话里的机器状态当成长期事实，统一以最新报告为准：

- `release/windows-build-prereqs-report.json`
- `release/windows-agent-release-readiness-report.json`
- `release/windows-agent-delivery-summary.md`

判断规则建议直接按下面三类看：

1. 如果 `portableBuildReady = true` 且 `setupBuildReady = true`
   - 这台机器可以继续完成便携包与 `setup.exe` 产出
2. 如果 `portableBuildReady = true` 但 `setupBuildReady = false`
   - 这台机器适合完成便携包、suite 验证和 generated `.iss`
   - 后续 `setup.exe` 编译交给有 `ISCC.exe` 的机器
3. 如果 `portableBuildReady = false`
   - 先按 `remediation.portableBuildBlockedBy` 与 `remediation.nextSteps` 补齐工具链

如果当前机器暂时还不适合完整出包，建议至少刷新这些证据再交接：

- `release/windows-build-prereqs-report.json`
- `release/windows-agent-suite/suite-summary.json`
- `release/windows-agent-release-readiness-report.json`
- `release/windows-agent-objective-audit.md`
- `release/windows-agent-delivery-summary.md`

## 当前机器的建议交付包

如果你准备把后续工作交给有 `.NET SDK 8` / `Windows App SDK` / `Inno Setup 6` 的机器，建议至少带走这些内容：

- 当前仓库源码
- `.codex-artifacts/windows-build-prereqs-report.json`
- `.codex-artifacts/windows-agent-suite-artifact-evidence/`
- `.codex-artifacts/windows-agent-release-readiness-artifact-evidence.json`
- `.codex-artifacts/windows-agent-objective-audit.md`
- `.codex-artifacts/windows-agent-delivery-summary.md`

如果这台机器后来能补齐 `.NET SDK 8`，但仍没有 `ISCC.exe`，那么建议额外再带走：

- `release/windows-agent-portable/DeviceStateConsoleAgent/`
- `release/windows-agent-portable/DeviceStateConsoleAgent-portable.zip`
- `release/windows-agent-setup/windows-agent-setup.generated.iss`
- `release/windows-agent-setup/setup-template-report.json`
- `release/windows-agent-setup/setup-generated-report.json`

## 下一台机器的最短接力顺序

如果下一台机器具备完整工具链，建议直接按这个最短顺序接力：

1. `verify-windows-build-prereqs.ps1`
2. 若需要真实 WinUI 发布，执行 `dotnet publish` 或 `build-windows-agent-portable.ps1`
3. `verify-windows-agent-bundle.ps1`
4. `verify-windows-agent-suite.ps1`
5. `build-windows-agent-setup.ps1`
6. 真实运行 `setup.exe`
7. `verify-windows-agent-installed-layout.ps1`
8. 真实卸载
9. `verify-windows-agent-uninstall-result.ps1`
10. `verify-windows-agent-setup-lifecycle.ps1`
11. `verify-windows-agent-release-readiness.ps1`
12. `export-windows-agent-delivery-summary.ps1`
13. 若希望沉淀完整的真实安装器执行证据，补跑 `verify-windows-agent-setup-execution.ps1`
