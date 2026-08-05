# Preserved desktop capabilities & Round-2 Contract Mappings

本文件是 Renderer 替换的功能对等基线及 Round 2 接口映射规范。新界面在保持 Clean-Room 架构隔离的前提下，100% 对齐了 `@dsc/shared` 的实际数据结构与 IPC `dscBridge` 规范。

---

## 1. 核心契约映射明细 (Round-2 Contract Mappings)

### 1.1 DeviceSummary 契约对齐
- **使用字段**: `deviceId`, `hostname`, `os`, `agentVersion`, `agentChannel`, `status`, `lastSeenAt`, `cpuUsagePercent`, `gpuUsagePercent`, `gpuMemoryUsagePercent`, `memoryUsagePercent`, `diskUsagePercent`
- **消除历史偏差**: 完全废弃 `id` 与 `lastSeen` 替代字段，视图与 Mock 均强制使用标准的 `deviceId` 和 `lastSeenAt`。

### 1.2 MetricsResponse 遥测数据与 Chart View-Model 规格化
- **接口字段**: `device`, `status`, `lastSeenAt`, `enabledMetrics`, `enabledDeviceIds`, `instanceMetricConfig`, `availableMetrics`, `latest`, `series`
- **规格化适配层 (`metricsNormalizer.ts`)**:
  - 从 `MetricsResponse.series` (`cpuUsagePercent`, `memoryUsagePercent`, `gpuUsagePercent`, `diskUsagePercent`, `networkRxBytesPerSec`, `networkTxBytesPerSec`) 抽取并对齐时间戳。
  - 生成稳定的 `NormalizedChartPoint[]` 消费模型供 `GuanlanChart` 组件无缝渲染。

### 1.3 DesktopConfigPatch 与 Local Agent Backend Config
- **嵌套补丁规范**:
  ```ts
  {
    connection?: { serverUrl?: string; deviceId?: string; hostname?: string };
    sampling?: { normalIntervalSeconds?: number; slowIntervalSeconds?: number };
    autoStartCollector?: boolean;
    autoRestartCollector?: boolean;
    cloudSyncEnabled?: boolean;
    dataRecordingEnabled?: boolean;
  }
  ```
- **密钥安全脱敏**: 从 `snapshot.localBackend.config.connection.secretConfigured` 读取密钥就绪状态。通信 Secret 仅允许通过 `dscBridge.setAgentSecret(secret)` 进行写操作，绝对不在前台界面或日志中回显。

### 1.4 DesktopAgentControlAction 动作与复合重启
- **规范动作**: `"start" | "stop" | "check-connection" | "detect-probes"`
- **重启实现**: UI 的「重启服务」按钮采用明确标注的复合操作，先后发起 `controlAgent("stop")` 与 `controlAgent("start")`，避免在 shared contract 中引入非法 `"restart"` 字面量。

### 1.5 DesktopAgentBackendState 完整状态规格
- **呈现字段**: `running`, `backendStartedAt`, `frontendParentPid`, `connectionStatus`, `cloudConfigPending`, `pendingSampleCount`, `pendingBytes`, `restartCount`, `effectiveUploadIntervalSeconds`, `configPath`, `configFileExists`, `diagnosticsPath`, `supportedProbePlans`, `detectedTargets` 等。

### 1.6 TrafficCalendarResponse 流量日历
- **结构对齐**: 使用 `mode` ("day" | "week" | "month"), `anchor`, `title`, `rangeStart`, `rangeEnd`, `cells`, `records`, `totalRxBytes`, `totalTxBytes`。
- **视图渲染**: 摒弃过时的 `days` 字段，以 `cells` 展现周期汇总与选中态，支持根据 `trafficMode` 切换维度。

### 1.7 dscBridge 请求对象传递
- 在 Context 与 BridgeAdapter 层透传 `DesktopSnapshotRequest`:
  `{ selectedDeviceId, metricWindow, trafficMode }`，确保获取与刷新时获取目标节点与窗口数据。

### 1.8 适配器模式与 Mock 预览安全
- **默认机制**: 运行于 Electron 环境时自动优先使用 `BridgeGuanlanDataAdapter` (`window.dsc`)。
- **Mock 试看开关**: 通过 `?mock=1` URL 参数或 `localStorage.dsc_mock_preview` 显示切换，Mock 地址统一采用安全的 `http://127.0.0.1:3100`（单 Hub 端口），避免试看模式侵入生产环境。
- **远端节点权限边界**: 远端设备仅提供遥测与运行状态只读视图；`saveFanNote` 等风扇备注写操作仅在「此设备」页且本机设备 ID 与遥测设备 ID 匹配时开放。

---

## 2. 界面与交互基线 (UI & Interaction Baselines)

- **标准中文导航标签**: **总览** (Overview)、**设备** (Devices)、**历史** (History)、**此设备** (This Device)、**诊断** (Diagnostics)、**设置** (Settings)。
- **窄屏无障碍适应 (390px)**: 底部导航栏在 Compact 模式下使用 4 项主导航 + 「更多」Popover 结构，彻底解决 6 标签在狭窄屏幕挤压溢出问题。
- **交互与无障碍**: 所有按钮统一采用 `<button type="button">`，带有显式 `<label>`/`aria-label`；全界面可使用 `Tab` 进行 `:focus-visible` 轮转，键盘按 `Esc` 可平滑关闭 Overlay 面板与 Modal 弹窗。
- **完整状态覆盖**: 全视图内置 `loading`、`error`、`cached`、`stopped`、`empty` 显式容器，并在网络或 Agent 异常时提供快速重试动作按钮。
- **境界校验**: `check:desktop-ui-boundaries` 脚本自动剥离注释后严格扫描任何针对 `apps/web` 或旧 token 的非授权引用，确保 Clean-Room 隔离边界零污染。

---

## 3. Round-3 预 CI 正确性与默认渲染器切换 (Round-3 Pre-CI Pass)

- **生产默认**: 观澜 (`GuanlanApp`) 正式提升为 Electron 客户端默认渲染器。
- **可逆回退**: 传统 UI 仅在 URL 包含 `?ui=legacy` 或 `localStorage.dsc_legacy_ui="true"` 时激活，并在设置视图中提供回退/恢复按钮。
- **真实 Bridge 优先**: 在 Electron 运行环境下默认使用 `BridgeGuanlanDataAdapter` 配合 `window.dsc` IPC 桥，同时保留 `?mock=1` 独立 Mock 测试通道。
- **与 CI 工作流强关联**: `ci.yml` 中的 `desktop` 与 `verify` 任务均已集成 `pnpm check:desktop-ui-boundaries` 与 `pnpm test:ui-helpers` 静态检查。
- **详细契约与测试映射**: 详见 [contract-mapping.md](file:///C:/项目/设备状态控制台/docs/ui-rebuild/contract-mapping.md)。
