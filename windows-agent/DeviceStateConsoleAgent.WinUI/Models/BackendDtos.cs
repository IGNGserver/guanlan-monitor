namespace DeviceStateConsoleAgent.WinUI.Models;

public sealed class AgentConnectionConfig
{
    public string ServerUrl { get; set; } = "http://127.0.0.1:3100";
    public string Secret { get; set; } = "";
    public string DeviceId { get; set; } = "windows-agent";
    public string Hostname { get; set; } = "Windows Agent";
}

public sealed class ViewerDeviceSummaryDto
{
    public string DeviceId { get; set; } = "";
    public string Hostname { get; set; } = "";
    public string Os { get; set; } = "";
    public string Status { get; set; } = "offline";
    public string? LastSeenAt { get; set; }
    public double? CpuUsagePercent { get; set; }
    public double? GpuUsagePercent { get; set; }
    public double? GpuMemoryUsagePercent { get; set; }
    public double? MemoryUsagePercent { get; set; }
    public double? DiskUsagePercent { get; set; }
}

public sealed class ViewerDeviceMetricsDto
{
    public string Status { get; set; } = "offline";
    public string LastSeenAt { get; set; } = "";
    public List<string> EnabledMetrics { get; set; } = new();
    public List<ViewerMetricAvailabilityDto> AvailableMetrics { get; set; } = new();
    public ViewerLatestMetricsDto Latest { get; set; } = new();
    public ViewerSeriesDto Series { get; set; } = new();
}

public sealed class ViewerMetricAvailabilityDto
{
    public string Key { get; set; } = "";
    public bool Available { get; set; }
}

public sealed class ViewerSamplePointDto
{
    public string Timestamp { get; set; } = "";
    public double Value { get; set; }
}

public sealed class ViewerSeriesDto
{
    public List<ViewerSamplePointDto> CpuUsagePercent { get; set; } = new();
    public List<ViewerSamplePointDto> CpuFrequencyMHz { get; set; } = new();
    public List<ViewerSamplePointDto> CpuTemperatureC { get; set; } = new();
    public List<ViewerSamplePointDto> MemoryUsagePercent { get; set; } = new();
    public List<ViewerSamplePointDto> SwapUsagePercent { get; set; } = new();
    public List<ViewerSamplePointDto> MemoryUsedBytes { get; set; } = new();
    public List<ViewerSamplePointDto> SwapUsedBytes { get; set; } = new();
    public List<ViewerSamplePointDto> DiskUsagePercent { get; set; } = new();
    public List<ViewerSamplePointDto> DiskUsedBytes { get; set; } = new();
    public List<ViewerSamplePointDto> DiskReadBytesPerSec { get; set; } = new();
    public List<ViewerSamplePointDto> DiskWriteBytesPerSec { get; set; } = new();
    public List<ViewerSamplePointDto> GpuUsagePercent { get; set; } = new();
    public List<ViewerSamplePointDto> GpuEncodePercent { get; set; } = new();
    public List<ViewerSamplePointDto> GpuDecodePercent { get; set; } = new();
    public List<ViewerSamplePointDto> GpuFrequencyMHz { get; set; } = new();
    public List<ViewerSamplePointDto> GpuMemoryUsagePercent { get; set; } = new();
    public List<ViewerSamplePointDto> GpuTemperatureC { get; set; } = new();
    public List<ViewerSamplePointDto> NetworkRxBytesPerSec { get; set; } = new();
    public List<ViewerSamplePointDto> NetworkTxBytesPerSec { get; set; } = new();
    public List<ViewerSamplePointDto> TrafficRxBytes { get; set; } = new();
    public List<ViewerSamplePointDto> TrafficTxBytes { get; set; } = new();
    public List<ViewerCpuMetricSeriesDto> Cpus { get; set; } = new();
    public List<ViewerDiskMetricSeriesDto> Disks { get; set; } = new();
    public List<ViewerNetworkMetricSeriesDto> Networks { get; set; } = new();
    public List<ViewerGpuMetricSeriesDto> Gpus { get; set; } = new();
    public List<ViewerFanMetricSeriesDto> Fans { get; set; } = new();
}

public sealed class ViewerCpuMetricSeriesDto
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "CPU";
    public string? Model { get; set; }
    public int? CoreCount { get; set; }
    public int? LogicalCount { get; set; }
    public List<ViewerSamplePointDto> UsagePercent { get; set; } = new();
    public List<ViewerSamplePointDto> FrequencyMHz { get; set; } = new();
    public List<ViewerSamplePointDto> TemperatureC { get; set; } = new();
}

public sealed class ViewerDiskMetricSeriesDto
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "磁盘";
    public string MountPoint { get; set; } = "";
    public string? Filesystem { get; set; }
    public string? Model { get; set; }
    public string? Vendor { get; set; }
    public List<ViewerSamplePointDto> UsagePercent { get; set; } = new();
    public List<ViewerSamplePointDto> ReadBytesPerSec { get; set; } = new();
    public List<ViewerSamplePointDto> WriteBytesPerSec { get; set; } = new();
}

public sealed class ViewerNetworkMetricSeriesDto
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "网卡";
    public string? MacAddress { get; set; }
    public List<string> Ipv4 { get; set; } = new();
    public List<string> Ipv6 { get; set; } = new();
    public List<ViewerSamplePointDto> RxBytesPerSec { get; set; } = new();
    public List<ViewerSamplePointDto> TxBytesPerSec { get; set; } = new();
    public List<ViewerSamplePointDto> TrafficRxBytes { get; set; } = new();
    public List<ViewerSamplePointDto> TrafficTxBytes { get; set; } = new();
}

public sealed class ViewerGpuMetricSeriesDto
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "显卡";
    public List<ViewerSamplePointDto> UsagePercent { get; set; } = new();
    public List<ViewerSamplePointDto> EncodePercent { get; set; } = new();
    public List<ViewerSamplePointDto> DecodePercent { get; set; } = new();
    public List<ViewerSamplePointDto> FrequencyMHz { get; set; } = new();
    public List<ViewerSamplePointDto> MemoryUsagePercent { get; set; } = new();
    public List<ViewerSamplePointDto> TemperatureC { get; set; } = new();
}

public sealed class ViewerFanMetricSeriesDto
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "风扇";
    public string? Interface { get; set; }
    public List<ViewerSamplePointDto> Rpm { get; set; } = new();
}

public sealed class ViewerLatestMetricsDto
{
    public double CpuUsagePercent { get; set; }
    public double MemoryUsedBytes { get; set; }
    public double MemoryTotalBytes { get; set; }
    public double SwapUsedBytes { get; set; }
    public double SwapTotalBytes { get; set; }
    public double DiskUsedBytes { get; set; }
    public double DiskTotalBytes { get; set; }
    public List<ViewerDiskDto> Disks { get; set; } = new();
    public List<ViewerGpuDto> Gpus { get; set; } = new();
    public double? CpuFrequencyMHz { get; set; }
    public double? CpuTemperatureC { get; set; }
    public double NetworkRxBytesPerSec { get; set; }
    public double NetworkTxBytesPerSec { get; set; }
}

public sealed class ViewerDiskDto
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "磁盘";
    public string MountPoint { get; set; } = "";
    public string? Model { get; set; }
    public double UsedBytes { get; set; }
    public double TotalBytes { get; set; }
}

public sealed class ViewerGpuDto
{
    public string Name { get; set; } = "显卡";
    public double UtilizationPercent { get; set; }
    public double MemoryUsedBytes { get; set; }
    public double MemoryTotalBytes { get; set; }
}

public sealed class AgentSamplingConfig
{
    public int NormalIntervalSeconds { get; set; } = 15;
    public int FastIntervalSeconds { get; set; } = 5;
    public int SlowIntervalSeconds { get; set; } = 30;
    public int ViewerRealtimeHoldSeconds { get; set; } = 20;
    public bool RealtimeModeEnabled { get; set; }
    public string RealtimeModeExpiresAt { get; set; } = "";
    public string RealtimeModeSource { get; set; } = "";
}

public sealed class AgentProbeSelection
{
    public string Target { get; set; } = "";
    public string Provider { get; set; } = "builtin";
    public bool Enabled { get; set; } = true;
}

public sealed class AgentLocalConfig
{
    public AgentConnectionConfig Connection { get; set; } = new();
    public AgentSamplingConfig Sampling { get; set; } = new();
    public List<string> EnabledMetrics { get; set; } = new();
    public Dictionary<string, List<string>> EnabledDeviceIds { get; set; } = new();
    public Dictionary<string, List<string>> InstanceMetricConfig { get; set; } = new();
    public List<AgentProbeSelection> ProbeSelections { get; set; } = new();
    public bool CloudSyncEnabled { get; set; } = true;
    public bool DataRecordingEnabled { get; set; } = true;
    public bool AutoRestartCollector { get; set; } = true;
    public bool AutoStartCollector { get; set; }
}

public sealed class ProbePlanSupport
{
    public string Target { get; set; } = "";
    public List<string> Providers { get; set; } = new();
    public string Default { get; set; } = "";
}

public sealed class BackendStateDto
{
    public bool Running { get; set; }
    public string BackendStartedAt { get; set; } = "";
    public int FrontendParentPid { get; set; }
    public string ChildStartedAt { get; set; } = "";
    public string ConnectionStatus { get; set; } = "stopped";
    public bool ControlStreamConnected { get; set; }
    public int ControlStreamReconnectCount { get; set; }
    public string LastControlStreamEventAt { get; set; } = "";
    public string LastControlStreamSnapshotAt { get; set; } = "";
    public string LastControlStreamChangeAt { get; set; } = "";
    public string LastControlStreamSnapshotKind { get; set; } = "";
    public string LastControlStreamSnapshotSource { get; set; } = "";
    public string LastControlStreamDisconnectAt { get; set; } = "";
    public string LastControlStreamReconnectAt { get; set; } = "";
    public string LastControlStreamError { get; set; } = "";
    public string ViewerRealtimePhase { get; set; } = "";
    public bool LastViewerRealtimeEnabled { get; set; }
    public int LastViewerRealtimeViewerCount { get; set; }
    public int LastViewerRealtimeDurationSeconds { get; set; }
    public string LastViewerRealtimeExpiresAt { get; set; } = "";
    public string LastChildLog { get; set; } = "";
    public string LastUploadAt { get; set; } = "";
    public string LastCloudSyncAt { get; set; } = "";
    public string LastCloudSyncError { get; set; } = "";
    public bool CloudConfigPending { get; set; }
    public string LastDetectAt { get; set; } = "";
    public string LastExitAt { get; set; } = "";
    public string LastRestartAt { get; set; } = "";
    public int RestartCount { get; set; }
    public int? LastExitCode { get; set; }
    public bool AutoRestartPending { get; set; }
    public bool RealtimeModeEnabled { get; set; }
    public string RealtimeModeExpiresAt { get; set; } = "";
    public string RealtimeModeSource { get; set; } = "";
    public int EffectiveUploadIntervalSeconds { get; set; }
    public string LastIssueCategory { get; set; } = "";
    public string LastIssueDetail { get; set; } = "";
    public string LastIssueAt { get; set; } = "";
    public int LastIssueCount { get; set; }
    public string LastIssueRecoveredAt { get; set; } = "";
    public string ConfigPath { get; set; } = "";
    public bool ConfigFileExists { get; set; }
    public string SyncStatePath { get; set; } = "";
    public bool SyncStateFileExists { get; set; }
    public string DiagnosticsPath { get; set; } = "";
    public bool DiagnosticsFileExists { get; set; }
    public AgentLocalConfig Config { get; set; } = new();
    public List<ProbePlanSupport> SupportedProbePlans { get; set; } = new();
    public List<ProbeTargetStateDto> DetectedTargets { get; set; } = new();
}

public sealed class BackendOkDto
{
    public bool Ok { get; set; }
}

public sealed class ConnectionCheckResultDto
{
    public bool Ok { get; set; }
    public bool Reachable { get; set; }
    public bool Authorized { get; set; }
    public bool DeviceKnown { get; set; }
    public string Status { get; set; } = "";
    public string Message { get; set; } = "";
    public string ServerTime { get; set; } = "";
}

public sealed class AgentRemoteStateDto
{
    public string DeviceId { get; set; } = "";
    public string Status { get; set; } = "offline";
    public string LastSeenAt { get; set; } = "";
    public AgentRemoteLatestDto Latest { get; set; } = new();
}

public sealed class AgentRemoteLatestDto
{
    public string Timestamp { get; set; } = "";
    public double CpuUsagePercent { get; set; }
    public List<CpuPackageStatsDto> CpuPackages { get; set; } = new();
    public MemoryStatsDto Memory { get; set; } = new();
    public StorageUsageDto DiskUsage { get; set; } = new();
    public List<DiskDeviceStatsDto> Disks { get; set; } = new();
    public NetworkRateDto NetworkRate { get; set; } = new();
    public List<NetworkInterfaceStatsDto> NetworkInterfaces { get; set; } = new();
    public List<GpuStatsDto> Gpus { get; set; } = new();
}

public sealed class CpuPackageStatsDto
{
    public string Name { get; set; } = "CPU";
    public string Model { get; set; } = "";
    public int? CoreCount { get; set; }
    public int? LogicalCount { get; set; }
    public double? FrequencyMHz { get; set; }
    public double? UsagePercent { get; set; }
    public double? TemperatureC { get; set; }
}

public sealed class DiskDeviceStatsDto
{
    public string Name { get; set; } = "磁盘";
    public string MountPoint { get; set; } = "";
    public string Filesystem { get; set; } = "";
    public string Model { get; set; } = "";
    public string Vendor { get; set; } = "";
    public double TotalBytes { get; set; }
    public double UsedBytes { get; set; }
}

public sealed class NetworkInterfaceStatsDto
{
    public string Name { get; set; } = "网卡";
    public string MacAddress { get; set; } = "";
    public List<string> Ipv4 { get; set; } = new();
    public double? RxBytesPerSec { get; set; }
    public double? TxBytesPerSec { get; set; }
    public double? TotalRxBytes { get; set; }
    public double? TotalTxBytes { get; set; }
}

public sealed class MemoryStatsDto
{
    public double TotalBytes { get; set; }
    public double UsedBytes { get; set; }
}

public sealed class StorageUsageDto
{
    public double TotalBytes { get; set; }
    public double UsedBytes { get; set; }
}

public sealed class NetworkRateDto
{
    public double RxBytesPerSec { get; set; }
    public double TxBytesPerSec { get; set; }
}

public sealed class GpuStatsDto
{
    public string Name { get; set; } = "显卡";
    public double UtilizationPercent { get; set; }
    public double MemoryUsedBytes { get; set; }
    public double MemoryTotalBytes { get; set; }
}

public sealed class ProbeDetectResponseDto
{
    public bool Ok { get; set; }
    public List<ProbePlanSupport> Providers { get; set; } = new();
    public List<ProbeTargetStateDto> DetectedTargets { get; set; } = new();
}

public sealed class ProbeTargetStateDto
{
    public string Target { get; set; } = "";
    public string Label { get; set; } = "";
    public List<ProbeDetectedTargetDto> Instances { get; set; } = new();
}

public sealed class ProbeDetectedTargetDto
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Subtitle { get; set; } = "";
    public bool Enabled { get; set; }
    public List<string> Metrics { get; set; } = new();
}
