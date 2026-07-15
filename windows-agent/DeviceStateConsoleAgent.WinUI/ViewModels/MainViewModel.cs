using System.Collections.ObjectModel;
using DeviceStateConsoleAgent.WinUI.Common;
using DeviceStateConsoleAgent.WinUI.Models;
using DeviceStateConsoleAgent.WinUI.Services;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.Win32;

namespace DeviceStateConsoleAgent.WinUI.ViewModels;

public sealed class MainViewModel : ObservableObject
{
    private const string StartupRegistryPath = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
    private const string StartupRegistryValue = "观澜";
    private const int BackendRestartFailureThreshold = 3;
    private const int BackendUnavailableConfirmationThreshold = 2;
    private static readonly TimeSpan NoticeOverrideHoldDuration = TimeSpan.FromSeconds(8);
    private static readonly TimeSpan BackendRecoveryCooldown = TimeSpan.FromSeconds(6);
    private static readonly Dictionary<string, string[]> BlockMetrics = new(StringComparer.OrdinalIgnoreCase)
    {
        ["cpu"] = ["cpuUsage", "cpuFrequency", "cpuTemperature"],
        ["memory"] = ["memoryUsage", "swapUsage"],
        ["disk"] = ["diskUsage", "diskRead", "diskWrite"],
        ["network"] = ["networkRxRate", "networkTxRate", "networkTraffic"],
        ["gpu"] = ["gpuUsage", "gpuEncode", "gpuDecode", "gpuFrequency", "gpuMemory", "gpuTemperature"],
        ["fan"] = []
    };
    private static readonly Dictionary<string, string> MetricLabels = new(StringComparer.OrdinalIgnoreCase)
    {
        ["cpuUsage"] = "CPU 使用率",
        ["cpuFrequency"] = "CPU 频率",
        ["cpuTemperature"] = "CPU 温度",
        ["memoryUsage"] = "内存使用率",
        ["swapUsage"] = "交换分区使用率",
        ["diskUsage"] = "磁盘占用",
        ["diskRead"] = "磁盘读取速率",
        ["diskWrite"] = "磁盘写入速率",
        ["networkRxRate"] = "网络接收速率",
        ["networkTxRate"] = "网络发送速率",
        ["networkTraffic"] = "网络累计流量",
        ["gpuUsage"] = "显卡使用率",
        ["gpuEncode"] = "显卡编码利用率",
        ["gpuDecode"] = "显卡解码利用率",
        ["gpuFrequency"] = "显卡频率",
        ["gpuMemory"] = "显卡显存占用",
        ["gpuTemperature"] = "显卡温度"
    };
    private static readonly Dictionary<string, string> IssueCategoryLabels = new(StringComparer.OrdinalIgnoreCase)
    {
        ["upload"] = "上传失败",
        ["config_parse"] = "配置解析失败",
        ["config_read"] = "配置读取失败",
        ["slow_metrics"] = "慢指标刷新失败",
        ["cpu_slow"] = "CPU 慢指标超时",
        ["disk_slow"] = "磁盘慢指标超时",
        ["disk_fast"] = "磁盘快速指标失败",
        ["network_slow"] = "网络慢指标超时",
        ["network_fast"] = "网络快速指标失败",
        ["unknown"] = "未知异常"
    };

    private readonly BackendHostService _hostService = new();
    private readonly BackendApiClient _apiClient = new();
    private readonly DispatcherQueue _dispatcherQueue;
    private readonly Dictionary<string, List<string>> _enabledDeviceIdsDraft = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, List<string>> _instanceMetricConfigDraft = new(StringComparer.OrdinalIgnoreCase);
    private CancellationTokenSource? _pollingCts;
    private bool _initialized;
    private bool _isApplyingState;
    private bool _isShuttingDown;
    private int _saveVersion;
    private int _backendFailureCount;
    private int _backendRecoveryAttemptCount;
    private bool _backendReachable;
    private bool _backendRunning;
    private bool _hasActiveUploadIssue;
    private bool _lastCloudSyncSucceeded;
    private bool _hasCloudSyncAttempt;
    private bool _cloudPushPending;
    private bool _detectNeedsRefresh;
    private bool _isPortableMode;
    private bool _isUsingSharedBackend;
    private int _frontendParentPid;
    private bool _localSavePending;
    private bool _configFileExists;
    private bool _syncStateFileExists;
    private bool _diagnosticsFileExists;
    private string _activeOperationCode = "";
    private string _detectFreshnessFingerprint = "";
    private string _localSaveStatusCode = "idle";
    private DateTimeOffset? _backendUnavailableSince;
    private DateTimeOffset _noticeOverrideExpiresAt = DateTimeOffset.MinValue;
    private DateTimeOffset _lastBackendRecoveryAttemptAt = DateTimeOffset.MinValue;
    private string _connectionStatusCode = "stopped";
    private string _lastUploadAtText = "";
    private string _lastCloudSyncAtText = "";
    private string _lastCloudSyncErrorText = "";

    private string _statusText = "后端未启动";
    private string _connectionText = "尚未连接中枢";
    private string _connectionCheckText = "可在启动采集器前先检查中枢连通性与密钥是否正确。";
    private string _connectionCheckDetailText = "连接检查会区分中枢不可达、密钥错误、设备尚未出现和设备已被中枢识别。";
    private string _localBackendStateText = "本地 Go backend 尚未启动。";
    private string _collectorStateText = "采集器当前不可用。";
    private string _backendRecoveryText = "本地 backend 运行稳定，WinUI 正在持续守护。";
    private string _backendRecoveryDetailText = "若本地 backend 异常掉线，WinUI 会自动重新拉起或重启。";
    private string _lastLogText = "最近日志会显示在这里。";
    private string _cloudSyncText = "尚未推送展示配置。";
    private string _configPathText = "配置文件路径待确认。";
    private string _syncStatePathText = "同步状态文件：当前不可用。";
    private string _diagnosticsPathText = "诊断日志路径待确认。";
    private string _issueSummaryText = "最近异常分类：暂无。";
    private string _realtimeStatusText = "当前处于常态上传模式。";
    private string _realtimeControlText = "中枢实时控制通道状态待确认。";
    private string _controlStreamStatusCode = "unknown";
    private string _controlStreamStateText = "实时控制链路状态待确认。";
    private string _controlStreamLastEventText = "最近推送：暂无。";
    private string _controlStreamLastDisconnectText = "最近断开：暂无。";
    private string _controlStreamReconnectText = "主动重连：暂无。";
    private string _controlStreamHealthText = "链路健康度：当前未发现频繁重连。";
    private string _controlStreamCategoryText = "问题类别：待确认。";
    private string _controlStreamErrorText = "断开原因：暂无。";
    private string _controlStreamActionText = "建议操作：等待建立主动推送链路；若长期未连通，可先检查中枢连接信息。";
    private string _controlStreamTransportText = "控制方式：优先使用服务端主动推送，异常时回退到低频轮询。";
    private string _remoteDataStatusText = "尚未读取中枢中的本机最新数据。";
    private string _remoteCpuText = "CPU：暂无数据";
    private string _remoteMemoryText = "内存：暂无数据";
    private string _remoteDiskText = "磁盘：暂无数据";
    private string _remoteNetworkText = "网络：暂无数据";
    private string _remoteGpuText = "显卡：暂无数据";
    private string _localSampleTimestampText = "上次数据：暂无";
    private string _localCpuPayloadText = "CPU 上报字段：暂无";
    private string _localMemoryPayloadText = "内存上报字段：暂无";
    private string _localDiskPayloadText = "磁盘上报字段：暂无";
    private string _localNetworkPayloadText = "网卡上报字段：暂无";
    private string _viewerDataStatusText = "无法连接中枢系统。请先在服务器配置中保存地址和 Agent 密钥。";
    private bool _viewerSessionReady;
    private string _selectedViewerDeviceId = "";
    private string _selectedViewerDeviceName = "选择设备";
    private string _viewerDetailStatusText = "选择设备卡片后查看详细数据。";
    private string _viewerDetailMemoryText = "内存：--";
    private string _viewerDetailDiskText = "磁盘：--";
    private string _viewerDetailCpuText = "CPU：--";
    private string _viewerDetailGpuText = "显卡：--";
    private string _viewerDetailNetworkText = "网络：--";
    private string _viewerDetailFanText = "风扇：--";
    private bool _hasViewerCpuCharts;
    private bool _hasViewerMemoryCharts;
    private bool _hasViewerDiskCharts;
    private bool _hasViewerGpuCharts;
    private bool _hasViewerNetworkCharts;
    private bool _hasViewerFanCharts;
    private double _viewerCpuUsagePercent;
    private double _viewerMemoryUsagePercent;
    private double _viewerDiskUsagePercent;
    private double _viewerGpuUsagePercent;
    private double _viewerNetworkUsagePercent;
    private string _selectedMetricWindow = "1m";
    private string _viewerDeviceFilter = "";
    private readonly List<ViewerDeviceItemViewModel> _viewerDeviceCache = new();
    private string _storageModeText = "正在判断运行模式。";
    private string _noticeText = "请先配置中枢连接信息，然后启动采集器。";
    private string _localSaveStateText = "本地配置已加载，后续改动会自动保存。";
    private string _localSaveStateDetailText = "修改连接信息、频次、探测方案或实例开关后，WinUI 会先防抖，再写入本地 Go backend。";
    private string _detectFreshnessStatusCode = "idle";
    private string _detectFreshnessText = "当前还没有可用的探测结果。";
    private string _detectFreshnessDetailText = "首次使用时，建议先执行一次组件探测，再根据返回的实例清单决定保留哪些 CPU、磁盘和网卡记录。";
    private string _detectSummary = "当前探测方案尚未刷新。";
    private string _detectStatusText = "尚未执行组件探测，当前实例清单还不可用。";
    private string _cpuInstanceSummary = "执行组件探测后，这里会列出可单独开关的 CPU 实例。";
    private string _diskInstanceSummary = "执行组件探测后，这里会列出可单独开关的磁盘实例。";
    private string _networkInstanceSummary = "执行组件探测后，这里会列出可单独开关的网卡实例。";
    private string _gpuInstanceSummary = "执行组件探测后，这里会列出可单独开关的显卡实例。";
    private string _serverUrl = "http://127.0.0.1:3100";
    private string _secret = "";
    private string _deviceId = "windows-agent";
    private string _hostname = "Windows Agent";
    private int _fastIntervalSeconds = 5;
    private int _normalIntervalSeconds = 15;
    private int _slowIntervalSeconds = 30;
    private int _viewerRealtimeHoldSeconds = 20;
    private int _realtimeDurationMinutes = 10;
    private bool _cloudSyncEnabled = true;
    private bool _dataRecordingEnabled = true;
    private bool _autoRestartCollector = true;
    private bool _autoStartCollector;
    private bool _launchAtStartup;
    private bool _realtimeModeEnabled;
    private string _realtimeModeExpiresAt = "";
    private string _realtimeModeSource = "";
    private string _backendRecoveryStatusCode = "stable";
    private string _connectionCheckStatusCode = "idle";
    private bool _cpuEnabled;
    private bool _memoryEnabled;
    private bool _diskEnabled;
    private bool _networkEnabled;
    private bool _gpuEnabled;
    private bool _fanEnabled;
    private string _cpuProvider = "disabled";
    private string _memoryProvider = "disabled";
    private string _diskProvider = "disabled";
    private string _networkProvider = "disabled";
    private string _gpuProvider = "disabled";
    private string _fanProvider = "disabled";
    private IReadOnlyList<ProbeProviderOptionViewModel> _cpuProviderOptions = [ProbeProviderOptionViewModel.Disabled, ProbeProviderOptionViewModel.Gopsutil];
    private IReadOnlyList<ProbeProviderOptionViewModel> _memoryProviderOptions = [ProbeProviderOptionViewModel.Disabled, ProbeProviderOptionViewModel.Gopsutil];
    private IReadOnlyList<ProbeProviderOptionViewModel> _diskProviderOptions = [ProbeProviderOptionViewModel.Disabled, ProbeProviderOptionViewModel.Gopsutil];
    private IReadOnlyList<ProbeProviderOptionViewModel> _networkProviderOptions = [ProbeProviderOptionViewModel.Disabled, ProbeProviderOptionViewModel.Gopsutil];
    private IReadOnlyList<ProbeProviderOptionViewModel> _gpuProviderOptions = [ProbeProviderOptionViewModel.Disabled, ProbeProviderOptionViewModel.Wmi];
    private IReadOnlyList<ProbeProviderOptionViewModel> _fanProviderOptions = [ProbeProviderOptionViewModel.Disabled];

    private readonly ProbeInstanceGroupViewModel _cpuGroup;
    private readonly ProbeInstanceGroupViewModel _diskGroup;
    private readonly ProbeInstanceGroupViewModel _networkGroup;
    private readonly ProbeInstanceGroupViewModel _gpuGroup;
    private ProbeInstanceItemViewModel? _selectedInstanceMetricItem;

    public MainViewModel()
    {
        _dispatcherQueue = DispatcherQueue.GetForCurrentThread() ?? throw new InvalidOperationException("DispatcherQueue unavailable.");
        CpuInstances = new ObservableCollection<ProbeInstanceItemViewModel>();
        DiskInstances = new ObservableCollection<ProbeInstanceItemViewModel>();
        NetworkInstances = new ObservableCollection<ProbeInstanceItemViewModel>();
        GpuInstances = new ObservableCollection<ProbeInstanceItemViewModel>();
        CpuMetricToggles = BuildMetricItems("cpu");
        MemoryMetricToggles = BuildMetricItems("memory");
        DiskMetricToggles = BuildMetricItems("disk");
        NetworkMetricToggles = BuildMetricItems("network");
        GpuMetricToggles = BuildMetricItems("gpu");
        SelectedInstanceMetricToggles = new ObservableCollection<MetricToggleItemViewModel>();
        MetricWindows = new ObservableCollection<string> { "1m", "15m", "1d" };
        ViewerCpuTrendPoints = new ObservableCollection<TrendPointViewModel>();
        ViewerMemoryTrendPoints = new ObservableCollection<TrendPointViewModel>();
        ViewerDiskTrendPoints = new ObservableCollection<TrendPointViewModel>();
        ViewerGpuTrendPoints = new ObservableCollection<TrendPointViewModel>();
        ViewerNetworkTrendPoints = new ObservableCollection<TrendPointViewModel>();
        ViewerFanTrendPoints = new ObservableCollection<TrendPointViewModel>();
        ViewerCpuCharts = new ObservableCollection<ViewerDetailChartViewModel>();
        ViewerMemoryCharts = new ObservableCollection<ViewerDetailChartViewModel>();
        ViewerDiskCharts = new ObservableCollection<ViewerDetailChartViewModel>();
        ViewerGpuCharts = new ObservableCollection<ViewerDetailChartViewModel>();
        ViewerNetworkCharts = new ObservableCollection<ViewerDetailChartViewModel>();
        ViewerFanCharts = new ObservableCollection<ViewerDetailChartViewModel>();
        _cpuGroup = new ProbeInstanceGroupViewModel("CPU 实例", CpuInstances, () => CpuInstanceSummary);
        _diskGroup = new ProbeInstanceGroupViewModel("磁盘实例", DiskInstances, () => DiskInstanceSummary);
        _networkGroup = new ProbeInstanceGroupViewModel("网卡实例", NetworkInstances, () => NetworkInstanceSummary);
        _gpuGroup = new ProbeInstanceGroupViewModel("显卡实例", GpuInstances, () => GpuInstanceSummary);
        InstanceGroups = new ObservableCollection<ProbeInstanceGroupViewModel>
        {
            _cpuGroup,
            _diskGroup,
            _networkGroup,
            _gpuGroup
        };
        StartBackendCommand = new RelayCommand(StartBackendAsync, () => CanStartCollector);
        StopBackendCommand = new RelayCommand(StopBackendAsync, () => CanStopCollector);
        CheckConnectionCommand = new RelayCommand(CheckConnectionAsync, () => CanCheckConnection);
        PushCloudCommand = new RelayCommand(PushCloudAsync, () => CanPushCloud);
        DetectCommand = new RelayCommand(DetectAsync, () => CanRunDetect);
        ToggleRealtimeModeCommand = new RelayCommand(ToggleRealtimeModeAsync, () => CanToggleRealtime);
        LoginViewerCommand = new RelayCommand(LoginViewerAsync, () => CanLoginViewer);
    }

    public RelayCommand StartBackendCommand { get; }
    public RelayCommand StopBackendCommand { get; }
    public RelayCommand CheckConnectionCommand { get; }
    public RelayCommand PushCloudCommand { get; }
    public RelayCommand DetectCommand { get; }
    public RelayCommand ToggleRealtimeModeCommand { get; }
    public RelayCommand LoginViewerCommand { get; }

    public ObservableCollection<ProbeInstanceItemViewModel> CpuInstances { get; }
    public ObservableCollection<ProbeInstanceItemViewModel> DiskInstances { get; }
    public ObservableCollection<ProbeInstanceItemViewModel> NetworkInstances { get; }
    public ObservableCollection<ProbeInstanceItemViewModel> GpuInstances { get; }
    public ObservableCollection<ProbeInstanceGroupViewModel> InstanceGroups { get; }
    public ObservableCollection<MetricToggleItemViewModel> CpuMetricToggles { get; }
    public ObservableCollection<MetricToggleItemViewModel> MemoryMetricToggles { get; }
    public ObservableCollection<MetricToggleItemViewModel> DiskMetricToggles { get; }
    public ObservableCollection<MetricToggleItemViewModel> NetworkMetricToggles { get; }
    public ObservableCollection<MetricToggleItemViewModel> GpuMetricToggles { get; }
    public ObservableCollection<MetricToggleItemViewModel> SelectedInstanceMetricToggles { get; }
    public ObservableCollection<ViewerDeviceItemViewModel> ViewerDevices { get; } = new();
    public ObservableCollection<ViewerDeviceItemViewModel> FilteredViewerDevices { get; } = new();
    public ObservableCollection<string> MetricWindows { get; }
    public ObservableCollection<TrendPointViewModel> ViewerCpuTrendPoints { get; }
    public ObservableCollection<TrendPointViewModel> ViewerMemoryTrendPoints { get; }
    public ObservableCollection<TrendPointViewModel> ViewerDiskTrendPoints { get; }
    public ObservableCollection<TrendPointViewModel> ViewerGpuTrendPoints { get; }
    public ObservableCollection<TrendPointViewModel> ViewerNetworkTrendPoints { get; }
    public ObservableCollection<TrendPointViewModel> ViewerFanTrendPoints { get; }
    public ObservableCollection<ViewerDetailChartViewModel> ViewerCpuCharts { get; }
    public ObservableCollection<ViewerDetailChartViewModel> ViewerMemoryCharts { get; }
    public ObservableCollection<ViewerDetailChartViewModel> ViewerDiskCharts { get; }
    public ObservableCollection<ViewerDetailChartViewModel> ViewerGpuCharts { get; }
    public ObservableCollection<ViewerDetailChartViewModel> ViewerNetworkCharts { get; }
    public ObservableCollection<ViewerDetailChartViewModel> ViewerFanCharts { get; }
    public bool HasViewerCpuCharts { get => _hasViewerCpuCharts; private set => SetProperty(ref _hasViewerCpuCharts, value); }
    public bool HasViewerMemoryCharts { get => _hasViewerMemoryCharts; private set => SetProperty(ref _hasViewerMemoryCharts, value); }
    public bool HasViewerDiskCharts { get => _hasViewerDiskCharts; private set => SetProperty(ref _hasViewerDiskCharts, value); }
    public bool HasViewerGpuCharts { get => _hasViewerGpuCharts; private set => SetProperty(ref _hasViewerGpuCharts, value); }
    public bool HasViewerNetworkCharts { get => _hasViewerNetworkCharts; private set => SetProperty(ref _hasViewerNetworkCharts, value); }
    public bool HasViewerFanCharts { get => _hasViewerFanCharts; private set => SetProperty(ref _hasViewerFanCharts, value); }

    public bool HasCpuInstances => CpuInstances.Count > 0;
    public bool HasDiskInstances => DiskInstances.Count > 0;
    public bool HasNetworkInstances => NetworkInstances.Count > 0;
    public bool HasGpuInstances => GpuInstances.Count > 0;
    public bool IsBackendActionBusy => !string.IsNullOrWhiteSpace(_activeOperationCode);
    public bool CanStartCollector => !IsBackendActionBusy && DataRecordingEnabled && HasConnectionConfig && _backendReachable && !_backendRunning;
    public bool CanStopCollector => !IsBackendActionBusy && _backendReachable && _backendRunning;
    public bool CanRunDetect => !IsBackendActionBusy && _backendReachable;
    public bool CanCheckConnection => !IsBackendActionBusy && _backendReachable && HasConnectionConfig;
    public bool CanPushCloud => !IsBackendActionBusy && HasConnectionConfig && _backendReachable && CloudSyncEnabled;
    public bool CanToggleRealtime => !IsBackendActionBusy && _backendReachable && (_backendRunning || RealtimeModeEnabled);
    public bool CanLoginViewer => !IsBackendActionBusy && ServerUrlPolicy.IsAllowed(ServerUrl) && !string.IsNullOrWhiteSpace(Secret);
    public string LocalBackendBadgeText => _backendReachable ? "本地后端在线" : "本地后端离线";
    public string CollectorBadgeText =>
        !_backendReachable ? "采集器不可用" :
        _backendRunning ? "采集器运行中" :
        "采集器未运行";
    public string ConnectionBadgeText => ResolveConnectionBadgeText(_connectionStatusCode);
    public string ControlStreamBadgeText => ResolveControlStreamBadgeText(_controlStreamStatusCode);
    public string RunModeBadgeText => _isPortableMode ? "便携模式" : "安装模式";
    public string BackendRecoveryBadgeText => ResolveBackendRecoveryBadgeText(_backendRecoveryStatusCode);
    public string LocalSaveBadgeText => ResolveLocalSaveBadgeText(_localSaveStatusCode);
    public string DetectFreshnessBadgeText => ResolveDetectFreshnessBadgeText(_detectFreshnessStatusCode);
    public bool IsInstanceEditingEnabled =>
        !IsBackendActionBusy &&
        string.Equals(_detectFreshnessStatusCode, "fresh", StringComparison.OrdinalIgnoreCase);
    public string InstanceEditingHintText => BuildInstanceEditingHintText(_detectFreshnessStatusCode, IsBackendActionBusy);
    public ProbeInstanceItemViewModel? SelectedInstanceMetricItem
    {
        get => _selectedInstanceMetricItem;
        private set
        {
            if (ReferenceEquals(_selectedInstanceMetricItem, value))
            {
                return;
            }

            _selectedInstanceMetricItem = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(HasSelectedInstanceMetricEditor));
            OnPropertyChanged(nameof(SelectedInstanceMetricEditorTitle));
            OnPropertyChanged(nameof(SelectedInstanceMetricEditorSubtitle));
            OnPropertyChanged(nameof(SelectedInstanceMetricEditorSummary));
        }
    }
    public bool HasSelectedInstanceMetricEditor => SelectedInstanceMetricItem is not null && SelectedInstanceMetricToggles.Count > 0;
    public string SelectedInstanceMetricEditorTitle =>
        SelectedInstanceMetricItem is null
            ? "实例指标细化"
            : $"{ResolveTargetLabel(SelectedInstanceMetricItem.Target)} · {SelectedInstanceMetricItem.Name}";
    public string SelectedInstanceMetricEditorSubtitle =>
        SelectedInstanceMetricItem is null
            ? "从上面的实例列表中选择一个条目后，这里会显示它的指标开关。"
            : string.IsNullOrWhiteSpace(SelectedInstanceMetricItem.Subtitle)
                ? $"实例 ID：{SelectedInstanceMetricItem.Id}"
                : $"{SelectedInstanceMetricItem.Subtitle} · 实例 ID：{SelectedInstanceMetricItem.Id}";
    public string SelectedInstanceMetricEditorSummary
    {
        get
        {
            if (SelectedInstanceMetricItem is null)
            {
                return "如果你希望只记录某个实例的部分指标，可以先点击对应条目的“细化指标”。";
            }

            var enabledCount = SelectedInstanceMetricToggles.Count(item => item.IsEnabled);
            return enabledCount == 0
                ? "当前这个实例的指标已全部关闭；本地配置保存后，agent 将不再发送这个实例的具体指标值。"
                : $"当前这个实例保留 {enabledCount}/{SelectedInstanceMetricToggles.Count} 个指标。未勾选的指标会在本地发送阶段被过滤。";
        }
    }
    public bool ShowConnectionCheckWarning => string.Equals(_connectionCheckStatusCode, "warning", StringComparison.OrdinalIgnoreCase) || string.Equals(_connectionCheckStatusCode, "error", StringComparison.OrdinalIgnoreCase);
    public bool ShowConnectionCheckSuccess => string.Equals(_connectionCheckStatusCode, "success", StringComparison.OrdinalIgnoreCase);
    public string CpuMetricSummary => BuildMetricSummary("CPU", CpuMetricToggles, CpuEnabled);
    public string MemoryMetricSummary => BuildMetricSummary("内存", MemoryMetricToggles, MemoryEnabled);
    public string DiskMetricSummary => BuildMetricSummary("磁盘", DiskMetricToggles, DiskEnabled);
    public string NetworkMetricSummary => BuildMetricSummary("网络", NetworkMetricToggles, NetworkEnabled);
    public string GpuMetricSummary => BuildMetricSummary("显卡", GpuMetricToggles, GpuEnabled);
    public string ConnectionCheckAlertTitle => ResolveConnectionCheckAlertTitle(_connectionCheckStatusCode);
    public bool ShowBackendRecoveryWarning => string.Equals(_backendRecoveryStatusCode, "waiting", StringComparison.OrdinalIgnoreCase) || string.Equals(_backendRecoveryStatusCode, "recovering", StringComparison.OrdinalIgnoreCase);
    public bool ShowBackendRecoveryRecovered => string.Equals(_backendRecoveryStatusCode, "recovered", StringComparison.OrdinalIgnoreCase);
    public bool ShowBackendRecoveryStable => string.Equals(_backendRecoveryStatusCode, "stable", StringComparison.OrdinalIgnoreCase);
    public bool ShowConnectionConnected => string.Equals(_connectionStatusCode, "connected", StringComparison.OrdinalIgnoreCase);
    public bool ShowConnectionBusy => string.Equals(_connectionStatusCode, "starting", StringComparison.OrdinalIgnoreCase) || string.Equals(_connectionStatusCode, "stopping", StringComparison.OrdinalIgnoreCase) || string.Equals(_connectionStatusCode, "restart-wait", StringComparison.OrdinalIgnoreCase);
    public bool ShowConnectionProblem => string.Equals(_connectionStatusCode, "error", StringComparison.OrdinalIgnoreCase) || string.Equals(_connectionStatusCode, "offline", StringComparison.OrdinalIgnoreCase) || string.Equals(_connectionStatusCode, "stopped", StringComparison.OrdinalIgnoreCase);
    public Visibility BackendRecoveryWarningVisibility => ShowBackendRecoveryWarning ? Visibility.Visible : Visibility.Collapsed;
    public Visibility BackendRecoveryRecoveredVisibility => ShowBackendRecoveryRecovered ? Visibility.Visible : Visibility.Collapsed;
    public Visibility BackendRecoveryStableVisibility => ShowBackendRecoveryStable ? Visibility.Visible : Visibility.Collapsed;
    public Visibility ConnectionConnectedVisibility => ShowConnectionConnected ? Visibility.Visible : Visibility.Collapsed;
    public Visibility ConnectionBusyVisibility => ShowConnectionBusy ? Visibility.Visible : Visibility.Collapsed;
    public Visibility ConnectionProblemVisibility => ShowConnectionProblem ? Visibility.Visible : Visibility.Collapsed;
    public string BackendRecoveryAlertTitle => ResolveBackendRecoveryAlertTitle(_backendRecoveryStatusCode);
    public bool ShowControlStreamWarning =>
        string.Equals(_controlStreamStatusCode, "fallback", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(_controlStreamStatusCode, "waiting", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(_controlStreamStatusCode, "recovering", StringComparison.OrdinalIgnoreCase);
    public bool ShowControlStreamKeepalive => string.Equals(_controlStreamStatusCode, "connected-keepalive", StringComparison.OrdinalIgnoreCase);
    public bool ShowControlStreamSuccess => string.Equals(_controlStreamStatusCode, "connected", StringComparison.OrdinalIgnoreCase);
    public bool ShowControlStreamInfo => string.Equals(_controlStreamStatusCode, "idle", StringComparison.OrdinalIgnoreCase);
    public Visibility ControlStreamWarningVisibility => ShowControlStreamWarning ? Visibility.Visible : Visibility.Collapsed;
    public Visibility ControlStreamKeepaliveVisibility => ShowControlStreamKeepalive ? Visibility.Visible : Visibility.Collapsed;
    public Visibility ControlStreamSuccessVisibility => ShowControlStreamSuccess ? Visibility.Visible : Visibility.Collapsed;
    public Visibility ControlStreamInfoVisibility => ShowControlStreamInfo ? Visibility.Visible : Visibility.Collapsed;
    public Visibility SelectedInstanceMetricEditorVisibility => HasSelectedInstanceMetricEditor ? Visibility.Visible : Visibility.Collapsed;
    public string ControlStreamAlertTitle => ResolveControlStreamAlertTitle(_controlStreamStatusCode);
    public string ControlStreamAlertDetail => BuildControlStreamAlertDetail(_controlStreamStatusCode, _controlStreamStateText, _controlStreamLastDisconnectText, _controlStreamCategoryText, _controlStreamErrorText, _controlStreamActionText, _controlStreamTransportText);
    public string ControlStreamSpotlightKicker => ResolveControlStreamSpotlightKicker(_controlStreamStatusCode);
    public string ControlStreamSpotlightHeadline => ResolveControlStreamSpotlightHeadline(_controlStreamStatusCode);
    public string CloudSyncBadgeText =>
        !CloudSyncEnabled ? "展示同步关闭" :
        _cloudPushPending && !_hasCloudSyncAttempt ? "待首推送" :
        _cloudPushPending ? "待推送" :
        !_hasCloudSyncAttempt ? "尚未同步" :
        _lastCloudSyncSucceeded ? "云端已同步" :
        "云端同步失败";
    public string StartButtonText =>
        _activeOperationCode == "start" ? "正在启动采集器..." :
        _backendRunning ? "采集器已启动" :
        "启动采集器";
    public string StopButtonText =>
        _activeOperationCode == "stop" ? "正在停止采集器..." :
        _backendRunning ? "停止采集器" :
        "等待启动后可停止";
    public string DetectButtonText =>
        _activeOperationCode == "detect" ? "正在执行组件探测..." :
        _backendReachable ? "执行组件探测" :
        "等待后端就绪";
    public string PushCloudButtonText =>
        _activeOperationCode == "push-cloud" ? "正在推送到中枢..." :
        !CloudSyncEnabled ? "先开启展示同步" :
        _cloudPushPending && !_hasCloudSyncAttempt ? "首次推送展示配置" :
        _cloudPushPending ? "推送最新展示配置" :
        !_hasCloudSyncAttempt ? "推送展示配置" :
        string.IsNullOrWhiteSpace(_lastCloudSyncErrorText) ? "重新推送展示配置" :
        "重试推送展示配置";
    public string CloudSyncActionHint =>
        !CloudSyncEnabled ? "当前展示同步已关闭。若要让网页和客户端更新展示类别，请先开启展示同步。" :
        _cloudPushPending && !_hasCloudSyncAttempt ? "当前设备的展示配置还没有进入中枢，建议先完成首次推送。" :
        _cloudPushPending ? "当前本地展示配置已经变化，建议现在推送到中枢，让网页和客户端更新类别显示。" :
        string.IsNullOrWhiteSpace(_lastCloudSyncErrorText) ? "当前不需要立即推送；只有你继续修改展示类别或实例范围后，才需要再次同步到中枢。" :
        "最近一次展示配置推送失败。修正问题后，可以重试推送到中枢。";
    public string CheckConnectionButtonText =>
        _activeOperationCode == "check-connection" ? "正在检查中枢连接..." : "检查中枢连接";
    public string RealtimeButtonText =>
        _activeOperationCode == "toggle-realtime" ? "正在切换实时模式..." :
        RealtimeModeEnabled ? "切回常态模式" :
        "进入实时模式";
    public string CurrentOperationBadgeText => IsBackendActionBusy ? "操作进行中" : "当前空闲";
    public string CurrentOperationText => BuildCurrentOperationText(_activeOperationCode);
    public string CurrentOperationDetailText => BuildCurrentOperationDetailText(_activeOperationCode);
    public string NoticeHeadline =>
        !HasConnectionConfig ? "先完成连接信息" :
        !_backendReachable ? "正在等待本地后端" :
        !_backendRunning ? "本地后端已就绪" :
        "采集器正在运行";
    public string FirstRunGuideTitle =>
        !HasConnectionConfig ? "第一步：填写连接信息" :
        !_backendReachable ? "正在等待本地后端恢复" :
        !_backendRunning ? "下一步：检查连接并启动采集器" :
        "已进入运行阶段";
    public string FirstRunGuideText =>
        !HasConnectionConfig
            ? "先填写 Server URL、Agent Secret 和 Device ID。便携模式会把配置直接写在程序目录；安装模式会写到 LocalAppData。"
            : !_backendReachable
                ? "本地 Go backend 还没有准备好。WinUI 会继续等待或自动恢复，恢复后就可以继续检查中枢连接。"
            : !_backendRunning
                ? "建议先执行一次“检查中枢连接”，确认地址和密钥无误；如果结果正常，再启动采集器完成首次上报。"
                : !CloudSyncEnabled
                    ? "采集器已经运行，本地配置也会立即生效；但你当前关闭了展示同步，所以网页和客户端暂时不会跟随更新展示类别。"
                : _cloudPushPending
                    ? "采集器已经运行，本地配置也已生效。若要让网页和客户端更新展示类别，请记得再推送一次展示配置到中枢。"
                    : "采集器已经运行。你现在可以继续调整采样频次、探测方案和实例记录范围；展示配置有变更时，再按需推送到中枢。";
    public string ModeGuideTitle =>
        _isPortableMode ? "当前是便携模式" : "当前是安装模式";
    public string ModeGuideText =>
        _isPortableMode
            ? "当前目录可直接携带和拷贝，连接信息、本地展示配置与同步状态会跟着程序目录一起移动。"
            : "当前程序按安装版方式运行，二进制位于安装目录，本地连接信息和同步状态默认写入 LocalAppData。";
    public string ModeStartupTitle =>
        _isPortableMode ? "便携包首启建议" : "安装版首启建议";
    public string ModeStartupText =>
        _isPortableMode
            ? !HasConnectionConfig
                ? "建议先在当前目录下完成连接信息配置；确认无误后，这整套目录就可以直接带走或复制到其他位置继续使用。"
                : "当前目录已经具备本地配置基础。完成连接检查和首次上报后，就可以把这整套目录作为可携带 agent 包继续使用。"
            : !HasConnectionConfig
                ? "建议先在安装后的第一次启动中完成连接信息配置；后续重新打开时会继续复用 LocalAppData 里的本地配置。"
                : "当前安装版已经具备本地配置基础。完成连接检查和首次上报后，后续升级或重新安装也更容易延续现有本地配置。";
    public string ModeStartupDetailText =>
        _isPortableMode
            ? "便携模式适合测试、临时部署和整目录迁移；如果要分发给其他机器，通常把 backend、前端和配置目录一起保留即可。"
            : "安装模式适合长期驻留使用；程序目录和配置目录分离，卸载或重装时也更容易选择是否保留本地配置与同步状态。";
    public string ModeGuideDetailText
    {
        get
        {
            var configText = string.IsNullOrWhiteSpace(_configPathText) ? "配置文件路径待确认。" : _configPathText;
            var syncText = string.IsNullOrWhiteSpace(_syncStatePathText) ? "同步状态文件路径待确认。" : _syncStatePathText;
            return _isPortableMode
                ? $"{configText} {syncText} 适合测试、U 盘分发或临时带走整套目录。"
                : $"{configText} {syncText} 适合长期安装使用；重新安装时也更容易保留本地配置。";
        }
    }
    public string LocalArtifactBadgeText => ResolveLocalArtifactBadgeText(_backendReachable, _configFileExists, _syncStateFileExists, _diagnosticsFileExists, _cloudPushPending);
    public string LocalArtifactSummaryText => BuildLocalArtifactSummaryText();
    public string LocalArtifactDetailText => BuildLocalArtifactDetailText();
    public bool HasConnectionConfig =>
        ServerUrlPolicy.IsAllowed(ServerUrl) &&
        !string.IsNullOrWhiteSpace(Secret) &&
        !string.IsNullOrWhiteSpace(DeviceId);
    public string ConnectionSetupHint =>
        !ServerUrlPolicy.IsAllowed(ServerUrl)
            ? ServerUrlPolicy.ValidationMessage(ServerUrl)
        : !HasConnectionConfig
            ? "请先填写 Server URL、Agent Secret 和 Device ID，再启动采集器或推送展示配置。"
            : !CloudSyncEnabled
                ? "连接信息已完成，可以先检查中枢连接并启动采集器；当前展示同步已关闭，本地改动不会推送到中枢。"
                : _cloudPushPending
                    ? "连接信息已完成，可以继续运行采集器；当前还有展示配置待推送到中枢，推送后网页和客户端才会更新类别显示。"
                    : "连接信息已完成，可以先检查中枢连接，再启动采集器；展示配置有变更时，再按需推送到中枢。";
    public string TrayMonitorStatusText =>
        !_backendReachable ? "监测状态待恢复" :
        _backendRunning ? "监测功能已开启" :
        "监测功能未开启";
    public string TrayMonitorDetailText =>
        !_backendReachable ? "本地 backend 当前离线，WinUI 会继续尝试恢复。" :
        _backendRunning ? CollectorStateText :
        "采集器当前未运行，启动后才会开始采集并提交数据。";
    public string TraySubmitStatusText
    {
        get
        {
            if (!_backendReachable)
            {
                return "提交状态待恢复";
            }

            if (!_backendRunning)
            {
                return "等待开启监测后提交";
            }

            if (_hasActiveUploadIssue)
            {
                return "最近提交失败";
            }

            if (!string.IsNullOrWhiteSpace(_lastUploadAtText))
            {
                return $"最近提交成功 · {FormatRealtimeExpiry(_lastUploadAtText)}";
            }

            return "等待首次提交";
        }
    }
    public string TraySubmitDetailText =>
        !_backendReachable ? "本地 backend 离线时无法确认最近一次数据提交结果。" :
        !_backendRunning ? "采集器未运行，因此还没有新的监测数据提交。" :
        _hasActiveUploadIssue ? IssueSummaryText :
        !string.IsNullOrWhiteSpace(_lastUploadAtText) ? "最近一次实时监测数据已经成功提交到中枢。" :
        "当前链路已就绪，正在等待第一笔监测数据上报。";
    public string TrayLifecycleStatusText =>
        !_backendReachable ? "生命周期待恢复" :
        _isUsingSharedBackend ? "当前窗口正在复用共享 backend" :
        _frontendParentPid > 0 ? $"当前窗口持有 backend 退出权 · PID {_frontendParentPid}" :
        "当前窗口正在直接管理 backend";
    public string TrayLifecycleDetailText =>
        !_backendReachable ? "本地 backend 当前离线，暂时无法确认它跟随哪个前端退出。" :
        _isUsingSharedBackend
            ? $"当前窗口附着到已存在的 backend；退出这个窗口时不会主动停止共享 backend。当前 backend 正跟随前端 PID {_frontendParentPid} 退出。"
            : _frontendParentPid > 0
                ? $"当前 backend 会跟随前端 PID {_frontendParentPid} 退出；如果这份 WinUI 被重新打开，owner 会自动切换到新的前端实例。"
                : "当前 backend owner PID 尚未确认，通常只会出现在刚完成启动、还没拿到状态快照的短暂阶段。";
    public string StatusText { get => _statusText; set => SetProperty(ref _statusText, value); }
    public string ConnectionText { get => _connectionText; set => SetProperty(ref _connectionText, value); }
    public string ConnectionCheckText { get => _connectionCheckText; set => SetProperty(ref _connectionCheckText, value); }
    public string ConnectionCheckDetailText { get => _connectionCheckDetailText; set => SetProperty(ref _connectionCheckDetailText, value); }
    public string LocalBackendStateText { get => _localBackendStateText; set => SetProperty(ref _localBackendStateText, value); }
    public string CollectorStateText { get => _collectorStateText; set => SetProperty(ref _collectorStateText, value); }
    public string BackendRecoveryText { get => _backendRecoveryText; set => SetProperty(ref _backendRecoveryText, value); }
    public string BackendRecoveryDetailText { get => _backendRecoveryDetailText; set => SetProperty(ref _backendRecoveryDetailText, value); }
    public string LastLogText { get => _lastLogText; set => SetProperty(ref _lastLogText, value); }
    public string CloudSyncText { get => _cloudSyncText; set => SetProperty(ref _cloudSyncText, value); }
    public string ConfigPathText { get => _configPathText; set => SetProperty(ref _configPathText, value); }
    public string SyncStatePathText { get => _syncStatePathText; set => SetProperty(ref _syncStatePathText, value); }
    public string DiagnosticsPathText { get => _diagnosticsPathText; set => SetProperty(ref _diagnosticsPathText, value); }
    public string IssueSummaryText { get => _issueSummaryText; set => SetProperty(ref _issueSummaryText, value); }
    public string RealtimeStatusText { get => _realtimeStatusText; set => SetProperty(ref _realtimeStatusText, value); }
    public string RealtimeControlText { get => _realtimeControlText; set => SetProperty(ref _realtimeControlText, value); }
    public string ControlStreamStateText { get => _controlStreamStateText; set => SetProperty(ref _controlStreamStateText, value); }
    public string ControlStreamLastEventText { get => _controlStreamLastEventText; set => SetProperty(ref _controlStreamLastEventText, value); }
    public string ControlStreamLastDisconnectText { get => _controlStreamLastDisconnectText; set => SetProperty(ref _controlStreamLastDisconnectText, value); }
    public string ControlStreamReconnectText { get => _controlStreamReconnectText; set => SetProperty(ref _controlStreamReconnectText, value); }
    public string ControlStreamHealthText { get => _controlStreamHealthText; set => SetProperty(ref _controlStreamHealthText, value); }
    public string ControlStreamCategoryText { get => _controlStreamCategoryText; set => SetProperty(ref _controlStreamCategoryText, value); }
    public string ControlStreamErrorText { get => _controlStreamErrorText; set => SetProperty(ref _controlStreamErrorText, value); }
    public string ControlStreamActionText { get => _controlStreamActionText; set => SetProperty(ref _controlStreamActionText, value); }
    public string ControlStreamTransportText { get => _controlStreamTransportText; set => SetProperty(ref _controlStreamTransportText, value); }
    public string RemoteDataStatusText { get => _remoteDataStatusText; set => SetProperty(ref _remoteDataStatusText, value); }
    public string RemoteCpuText { get => _remoteCpuText; set => SetProperty(ref _remoteCpuText, value); }
    public string RemoteMemoryText { get => _remoteMemoryText; set => SetProperty(ref _remoteMemoryText, value); }
    public string RemoteDiskText { get => _remoteDiskText; set => SetProperty(ref _remoteDiskText, value); }
    public string RemoteNetworkText { get => _remoteNetworkText; set => SetProperty(ref _remoteNetworkText, value); }
    public string RemoteGpuText { get => _remoteGpuText; set => SetProperty(ref _remoteGpuText, value); }
    public string LocalSampleTimestampText { get => _localSampleTimestampText; set => SetProperty(ref _localSampleTimestampText, value); }
    public string LocalCpuPayloadText { get => _localCpuPayloadText; set => SetProperty(ref _localCpuPayloadText, value); }
    public string LocalMemoryPayloadText { get => _localMemoryPayloadText; set => SetProperty(ref _localMemoryPayloadText, value); }
    public string LocalDiskPayloadText { get => _localDiskPayloadText; set => SetProperty(ref _localDiskPayloadText, value); }
    public string LocalNetworkPayloadText { get => _localNetworkPayloadText; set => SetProperty(ref _localNetworkPayloadText, value); }
    public string ViewerAccessKey
    {
        get => Secret;
        set => Secret = value;
    }
    public string ViewerDataStatusText { get => _viewerDataStatusText; set => SetProperty(ref _viewerDataStatusText, value); }
    public bool ViewerSessionReady { get => _viewerSessionReady; private set => SetProperty(ref _viewerSessionReady, value); }
    public string SelectedViewerDeviceName { get => _selectedViewerDeviceName; private set => SetProperty(ref _selectedViewerDeviceName, value); }
    public string ViewerDetailStatusText { get => _viewerDetailStatusText; set => SetProperty(ref _viewerDetailStatusText, value); }
    public string ViewerDetailMemoryText { get => _viewerDetailMemoryText; set => SetProperty(ref _viewerDetailMemoryText, value); }
    public string ViewerDetailDiskText { get => _viewerDetailDiskText; set => SetProperty(ref _viewerDetailDiskText, value); }
    public string ViewerDetailCpuText { get => _viewerDetailCpuText; set => SetProperty(ref _viewerDetailCpuText, value); }
    public string ViewerDetailGpuText { get => _viewerDetailGpuText; set => SetProperty(ref _viewerDetailGpuText, value); }
    public string ViewerDetailNetworkText { get => _viewerDetailNetworkText; set => SetProperty(ref _viewerDetailNetworkText, value); }
    public string ViewerDetailFanText { get => _viewerDetailFanText; set => SetProperty(ref _viewerDetailFanText, value); }
    public double ViewerCpuUsagePercent { get => _viewerCpuUsagePercent; private set => SetProperty(ref _viewerCpuUsagePercent, value); }
    public double ViewerMemoryUsagePercent { get => _viewerMemoryUsagePercent; private set => SetProperty(ref _viewerMemoryUsagePercent, value); }
    public double ViewerDiskUsagePercent { get => _viewerDiskUsagePercent; private set => SetProperty(ref _viewerDiskUsagePercent, value); }
    public double ViewerGpuUsagePercent { get => _viewerGpuUsagePercent; private set => SetProperty(ref _viewerGpuUsagePercent, value); }
    public double ViewerNetworkUsagePercent { get => _viewerNetworkUsagePercent; private set => SetProperty(ref _viewerNetworkUsagePercent, value); }
    public string SelectedMetricWindow { get => _selectedMetricWindow; set => SetProperty(ref _selectedMetricWindow, value); }
    public string ViewerDeviceFilter
    {
        get => _viewerDeviceFilter;
        set
        {
            if (!SetProperty(ref _viewerDeviceFilter, value))
            {
                return;
            }

            ApplyViewerFilter();
        }
    }
    public string StorageModeText { get => _storageModeText; set => SetProperty(ref _storageModeText, value); }
    public string NoticeText { get => _noticeText; set => SetProperty(ref _noticeText, value); }
    public string LocalSaveStateText { get => _localSaveStateText; set => SetProperty(ref _localSaveStateText, value); }
    public string LocalSaveStateDetailText { get => _localSaveStateDetailText; set => SetProperty(ref _localSaveStateDetailText, value); }
    public string DetectSummary { get => _detectSummary; set => SetProperty(ref _detectSummary, value); }
    public string DetectStatusText { get => _detectStatusText; set => SetProperty(ref _detectStatusText, value); }
    public string DetectFreshnessText { get => _detectFreshnessText; set => SetProperty(ref _detectFreshnessText, value); }
    public string DetectFreshnessDetailText { get => _detectFreshnessDetailText; set => SetProperty(ref _detectFreshnessDetailText, value); }
    public string CpuInstanceSummary { get => _cpuInstanceSummary; set => SetProperty(ref _cpuInstanceSummary, value); }
    public string DiskInstanceSummary { get => _diskInstanceSummary; set => SetProperty(ref _diskInstanceSummary, value); }
    public string NetworkInstanceSummary { get => _networkInstanceSummary; set => SetProperty(ref _networkInstanceSummary, value); }
    public string GpuInstanceSummary { get => _gpuInstanceSummary; set => SetProperty(ref _gpuInstanceSummary, value); }
    public string ServerUrl
    {
        get => _serverUrl;
        set
        {
            if (SetAndQueueSave(ref _serverUrl, value))
            {
                ViewerSessionReady = false;
            }
        }
    }
    public string Secret
    {
        get => _secret;
        set
        {
            if (SetAndQueueSave(ref _secret, value))
            {
                ViewerSessionReady = false;
                OnPropertyChanged(nameof(ViewerAccessKey));
                LoginViewerCommand?.RaiseCanExecuteChanged();
            }
        }
    }
    public string DeviceId { get => _deviceId; set => SetAndQueueSave(ref _deviceId, value); }
    public string Hostname { get => _hostname; set => SetAndQueueSave(ref _hostname, value); }
    public int FastIntervalSeconds
    {
        get => _fastIntervalSeconds;
        set
        {
            if (!SetAndQueueSave(ref _fastIntervalSeconds, value))
            {
                return;
            }

            OnPropertyChanged(nameof(FastIntervalValue));
        }
    }

    public int SlowIntervalSeconds
    {
        get => _slowIntervalSeconds;
        set
        {
            if (!SetAndQueueSave(ref _slowIntervalSeconds, value))
            {
                return;
            }

            OnPropertyChanged(nameof(SlowIntervalValue));
        }
    }

    public int NormalIntervalSeconds
    {
        get => _normalIntervalSeconds;
        set
        {
            if (!SetAndQueueSave(ref _normalIntervalSeconds, value))
            {
                return;
            }

            OnPropertyChanged(nameof(NormalIntervalValue));
        }
    }

    public double FastIntervalValue
    {
        get => FastIntervalSeconds;
        set => FastIntervalSeconds = Math.Max(1, (int)Math.Round(value));
    }

    public double NormalIntervalValue
    {
        get => NormalIntervalSeconds;
        set => NormalIntervalSeconds = Math.Max(1, (int)Math.Round(value));
    }

    public double SlowIntervalValue
    {
        get => SlowIntervalSeconds;
        set => SlowIntervalSeconds = Math.Max(5, (int)Math.Round(value));
    }
    public int ViewerRealtimeHoldSeconds
    {
        get => _viewerRealtimeHoldSeconds;
        set
        {
            if (!SetAndQueueSave(ref _viewerRealtimeHoldSeconds, value))
            {
                return;
            }

            OnPropertyChanged(nameof(ViewerRealtimeHoldValue));
        }
    }
    public double ViewerRealtimeHoldValue
    {
        get => ViewerRealtimeHoldSeconds;
        set => ViewerRealtimeHoldSeconds = Math.Max(5, (int)Math.Round(value));
    }
    public int RealtimeDurationMinutes
    {
        get => _realtimeDurationMinutes;
        set
        {
            if (!SetAndQueueSave(ref _realtimeDurationMinutes, value))
            {
                return;
            }

            OnPropertyChanged(nameof(RealtimeDurationValue));
        }
    }
    public double RealtimeDurationValue
    {
        get => RealtimeDurationMinutes;
        set => RealtimeDurationMinutes = Math.Max(1, (int)Math.Round(value));
    }
    public bool RealtimeModeEnabled { get => _realtimeModeEnabled; private set => SetProperty(ref _realtimeModeEnabled, value); }
    public bool CloudSyncEnabled { get => _cloudSyncEnabled; set => SetAndQueueSave(ref _cloudSyncEnabled, value); }
    public bool DataRecordingEnabled
    {
        get => _dataRecordingEnabled;
        set
        {
            if (SetAndQueueSave(ref _dataRecordingEnabled, value))
            {
                OnPropertyChanged(nameof(CanStartCollector));
                OnPropertyChanged(nameof(CanPushCloud));
            }
        }
    }
    public bool AutoRestartCollector { get => _autoRestartCollector; set => SetAndQueueSave(ref _autoRestartCollector, value); }
    public bool AutoStartCollector { get => _autoStartCollector; set => SetAndQueueSave(ref _autoStartCollector, value); }
    public bool LaunchAtStartup
    {
        get => _launchAtStartup;
        set
        {
            if (!SetProperty(ref _launchAtStartup, value)) return;
            try
            {
                using var key = Registry.CurrentUser.CreateSubKey(StartupRegistryPath, true);
                if (value)
                {
                    var launcher = Path.Combine(AppContext.BaseDirectory, "start-agent.vbs");
                    key?.SetValue(StartupRegistryValue, $"\"{Environment.SystemDirectory}\\wscript.exe\" \"{launcher}\" --minimized");
                }
                else
                {
                    key?.DeleteValue(StartupRegistryValue, false);
                }
            }
            catch
            {
                SetStickyNotice("无法更新开机自启设置。请检查当前用户的注册表权限。");
            }
        }
    }
    public bool CpuEnabled
    {
        get => _cpuEnabled;
        set
        {
            if (SetAndQueueSave(ref _cpuEnabled, value, markCloudDisplayDirty: true) && value && !_isApplyingState)
            {
                EnableDefaultMetrics(CpuMetricToggles);
            }
        }
    }
    public bool MemoryEnabled { get => _memoryEnabled; set => SetAndQueueSave(ref _memoryEnabled, value, markCloudDisplayDirty: true); }
    public bool DiskEnabled { get => _diskEnabled; set => SetAndQueueSave(ref _diskEnabled, value, markCloudDisplayDirty: true); }
    public bool NetworkEnabled { get => _networkEnabled; set => SetAndQueueSave(ref _networkEnabled, value, markCloudDisplayDirty: true); }
    public bool GpuEnabled
    {
        get => _gpuEnabled;
        set
        {
            if (!SetAndQueueSave(ref _gpuEnabled, value, markCloudDisplayDirty: true))
            {
                return;
            }

            if (!_isApplyingState &&
                value &&
                string.Equals(GpuProvider, "disabled", StringComparison.OrdinalIgnoreCase))
            {
                var preferredProvider = GpuProviderOptions.FirstOrDefault(item => !string.Equals(item.Key, "disabled", StringComparison.OrdinalIgnoreCase));
                if (preferredProvider is not null)
                {
                    GpuProvider = preferredProvider.Key;
                }
            }
        }
    }
    public bool FanEnabled { get => _fanEnabled; set => SetAndQueueSave(ref _fanEnabled, value, markCloudDisplayDirty: true); }
    public string CpuProvider { get => _cpuProvider; set => SetProvider(ref _cpuProvider, value, nameof(CpuProvider), enabled => CpuEnabled = enabled); }
    public string MemoryProvider { get => _memoryProvider; set => SetProvider(ref _memoryProvider, value, nameof(MemoryProvider), enabled => MemoryEnabled = enabled); }
    public string DiskProvider { get => _diskProvider; set => SetProvider(ref _diskProvider, value, nameof(DiskProvider), enabled => DiskEnabled = enabled); }
    public string NetworkProvider { get => _networkProvider; set => SetProvider(ref _networkProvider, value, nameof(NetworkProvider), enabled => NetworkEnabled = enabled); }
    public string GpuProvider { get => _gpuProvider; set => SetProvider(ref _gpuProvider, value, nameof(GpuProvider), enabled => GpuEnabled = enabled, markCloudDisplayDirty: true); }
    public string FanProvider { get => _fanProvider; set => SetProvider(ref _fanProvider, value, nameof(FanProvider), enabled => FanEnabled = enabled); }
    public IReadOnlyList<ProbeProviderOptionViewModel> CpuProviderOptions { get => _cpuProviderOptions; private set => SetProperty(ref _cpuProviderOptions, value); }
    public IReadOnlyList<ProbeProviderOptionViewModel> MemoryProviderOptions { get => _memoryProviderOptions; private set => SetProperty(ref _memoryProviderOptions, value); }
    public IReadOnlyList<ProbeProviderOptionViewModel> DiskProviderOptions { get => _diskProviderOptions; private set => SetProperty(ref _diskProviderOptions, value); }
    public IReadOnlyList<ProbeProviderOptionViewModel> NetworkProviderOptions { get => _networkProviderOptions; private set => SetProperty(ref _networkProviderOptions, value); }
    public IReadOnlyList<ProbeProviderOptionViewModel> GpuProviderOptions { get => _gpuProviderOptions; private set => SetProperty(ref _gpuProviderOptions, value); }
    public IReadOnlyList<ProbeProviderOptionViewModel> FanProviderOptions { get => _fanProviderOptions; private set => SetProperty(ref _fanProviderOptions, value); }

    public async Task InitializeAsync()
    {
        if (_initialized)
        {
            return;
        }

        _initialized = true;
        using (var key = Registry.CurrentUser.OpenSubKey(StartupRegistryPath, false))
        {
            _launchAtStartup = key?.GetValue(StartupRegistryValue) is not null;
        }
        OnPropertyChanged(nameof(LaunchAtStartup));
        try
        {
            _hostService.EnsureStarted();
            _isUsingSharedBackend = _hostService.IsAttachedToExistingBackend;
            _isPortableMode = _hostService.IsPortableMode();
            StorageModeText = _isPortableMode
                ? "便携模式：配置写入程序目录。"
                : "安装模式：配置写入 LocalAppData。";
            SetStatusNotice(_isUsingSharedBackend
                ? "检测到已有本地 Go backend，当前前端将直接复用它并加载状态。"
                : "本地 Go backend 已由前端自动拉起，正在加载状态。");
            RaiseStatusSummaryChanged();
        }
        catch (Exception ex)
        {
            SetStickyNotice($"启动本地 Go backend 失败：{ex.Message}");
            StatusText = "本地控制后端启动失败";
            return;
        }

        await RefreshStateAsync();
        if (AutoStartCollector && !_backendRunning)
        {
            await StartBackendAsync();
        }
        await LoginViewerAsync();
        await TryAttachFrontendOwnershipAsync();
        _pollingCts = new CancellationTokenSource();
        _ = Task.Run(() => PollStateLoopAsync(_pollingCts.Token));
    }

    public void Shutdown()
    {
        _isShuttingDown = true;
        _pollingCts?.Cancel();
        _hostService.Stop();
    }

    public void SelectInstanceMetricEditor(ProbeInstanceItemViewModel item)
    {
        if (item is null || !item.SupportsMetricEditing)
        {
            return;
        }

        SelectedInstanceMetricItem = item;
        RebuildSelectedInstanceMetricEditor();
        SetStickyNotice($"正在编辑 {item.Name} 的实例指标；调整后会自动保存到本地配置。");
    }

    public void ClearInstanceMetricEditor()
    {
        SelectedInstanceMetricItem = null;
        SelectedInstanceMetricToggles.Clear();
        OnPropertyChanged(nameof(HasSelectedInstanceMetricEditor));
        OnPropertyChanged(nameof(SelectedInstanceMetricEditorSummary));
    }

    private async Task RefreshStateAsync()
    {
        var state = await _apiClient.GetStateAsync(_pollingCts?.Token ?? CancellationToken.None);
        if (state is null)
        {
            await HandleBackendUnavailableAsync(_pollingCts?.Token ?? CancellationToken.None);
            return;
        }

        ApplyState(state);
    }

    private async Task SaveNowAsync()
    {
        MarkLocalSaveInProgress(_localSavePending
            ? "正在保存刚刚修改的本地配置。"
            : "正在将当前界面配置写入本地 backend。");

        try
        {
            await _apiClient.SaveConfigAsync(BuildConfig());
            MarkLocalSaveSucceeded(_localSavePending
                ? "本地配置已自动保存。"
                : "当前界面配置已写入本地 backend。");
        }
        catch (Exception ex)
        {
            MarkLocalSaveFailed(ex.Message);
            throw;
        }
    }

    private AgentLocalConfig BuildConfig()
    {
        return new AgentLocalConfig
        {
            Connection = new AgentConnectionConfig
            {
                ServerUrl = ServerUrl,
                Secret = Secret,
                DeviceId = DeviceId,
                Hostname = Hostname
            },
            Sampling = new AgentSamplingConfig
            {
                NormalIntervalSeconds = Math.Max(1, NormalIntervalSeconds),
                FastIntervalSeconds = Math.Max(1, FastIntervalSeconds),
                SlowIntervalSeconds = Math.Max(5, SlowIntervalSeconds),
                ViewerRealtimeHoldSeconds = Math.Max(5, ViewerRealtimeHoldSeconds),
                RealtimeModeEnabled = RealtimeModeEnabled,
                RealtimeModeExpiresAt = _realtimeModeExpiresAt,
                RealtimeModeSource = _realtimeModeSource
            },
            EnabledMetrics = ResolveEnabledMetrics(),
            EnabledDeviceIds = BuildEnabledDeviceIds(),
            InstanceMetricConfig = BuildInstanceMetricConfig(),
            ProbeSelections = new List<AgentProbeSelection>
            {
                new() { Target = "cpu", Provider = NormalizeProvider(CpuProvider, "builtin"), Enabled = CpuEnabled },
                new() { Target = "memory", Provider = NormalizeProvider(MemoryProvider, "builtin"), Enabled = MemoryEnabled },
                new() { Target = "disk", Provider = NormalizeProvider(DiskProvider, "builtin"), Enabled = DiskEnabled },
                new() { Target = "network", Provider = NormalizeProvider(NetworkProvider, "builtin"), Enabled = NetworkEnabled },
                new() { Target = "gpu", Provider = NormalizeProvider(GpuProvider, "disabled"), Enabled = GpuEnabled },
                new() { Target = "fan", Provider = NormalizeProvider(FanProvider, "disabled"), Enabled = FanEnabled }
            },
            CloudSyncEnabled = CloudSyncEnabled,
            DataRecordingEnabled = DataRecordingEnabled,
            AutoRestartCollector = AutoRestartCollector,
            AutoStartCollector = AutoStartCollector
        };
    }

    private async Task SaveDebouncedAsync(int version)
    {
        try
        {
            await Task.Delay(350);
            if (version != _saveVersion || _isApplyingState || !_initialized)
            {
                return;
            }

            await SaveNowAsync();
            SetStickyNotice("本地配置已自动保存。");
        }
        catch (Exception ex)
        {
            SetStickyNotice($"本地配置保存失败：{ex.Message}");
        }
    }

    private async Task StartBackendAsync()
    {
        BeginBackendAction("start");
        try
        {
            await SaveNowAsync();
            await _apiClient.StartAsync();
            SetStickyNotice("采集器启动命令已发送。");
            await RefreshStateAsync();
        }
        catch (Exception ex)
        {
            SetStickyNotice($"启动采集器失败：{ex.Message}");
        }
        finally
        {
            EndBackendAction("start");
        }
    }

    private async Task StopBackendAsync()
    {
        BeginBackendAction("stop");
        try
        {
            await _apiClient.StopAsync();
            SetStickyNotice("采集器停止命令已发送。");
            await RefreshStateAsync();
        }
        catch (Exception ex)
        {
            SetStickyNotice($"停止采集器失败：{ex.Message}");
        }
        finally
        {
            EndBackendAction("stop");
        }
    }

    private async Task PushCloudAsync()
    {
        if (!CloudSyncEnabled)
        {
            SetStickyNotice("当前已关闭云端展示配置推送，请先打开开关。");
            return;
        }

        BeginBackendAction("push-cloud");
        try
        {
            await SaveNowAsync();
            await _apiClient.PushCloudAsync();
            MarkCloudSyncSucceeded();
            UpdateCloudSyncPending(false);
            SetStickyNotice("展示配置已推送到中枢。");
            await RefreshStateAsync();
        }
        catch (Exception ex)
        {
            MarkCloudSyncFailed(ex.Message);
            SetStickyNotice($"推送至云端失败：{ex.Message}");
        }
        finally
        {
            EndBackendAction("push-cloud");
        }
    }

    private async Task CheckConnectionAsync()
    {
        BeginBackendAction("check-connection");
        try
        {
            await SaveNowAsync();
            var result = await _apiClient.CheckConnectionAsync();
            _connectionCheckStatusCode = ResolveConnectionCheckStatusCode(result);
            ConnectionCheckText = BuildConnectionCheckText(result);
            ConnectionCheckDetailText = BuildConnectionCheckDetailText(result);
            SetStickyNotice(result.Ok
                ? "中枢连接检查已完成，可以继续启动采集器。"
                : "中枢连接检查已完成，请根据结果修正连接信息。");
            RaiseStatusSummaryChanged();
        }
        catch (Exception ex)
        {
            _connectionCheckStatusCode = "error";
            ConnectionCheckText = $"连接检查失败：{ex.Message}";
            ConnectionCheckDetailText = "本地 backend 已经响应，但连接自检过程没有得到可用结果。请检查中枢地址、网络连通性或稍后重试。";
            SetStickyNotice($"连接检查失败：{ex.Message}");
            RaiseStatusSummaryChanged();
        }
        finally
        {
            EndBackendAction("check-connection");
        }
    }

    private async Task ToggleRealtimeModeAsync()
    {
        BeginBackendAction("toggle-realtime");
        try
        {
            await SaveNowAsync();
            var durationSeconds = RealtimeModeEnabled ? (int?)null : Math.Max(1, RealtimeDurationMinutes) * 60;
            await _apiClient.SetRealtimeModeAsync(!RealtimeModeEnabled, durationSeconds);
            SetStickyNotice(RealtimeModeEnabled ? "已请求切回常态上传模式。" : "已请求切换到实时上传模式。");
            await RefreshStateAsync();
        }
        catch (Exception ex)
        {
            SetStickyNotice($"切换实时模式失败：{ex.Message}");
        }
        finally
        {
            EndBackendAction("toggle-realtime");
        }
    }

    private async Task DetectAsync()
    {
        BeginBackendAction("detect");
        try
        {
            await SaveNowAsync();
            var response = await _apiClient.DetectAsync();
            if (response?.Providers is { Count: > 0 })
            {
                ApplySupportedPlans(response.Providers);
            }

            if (response?.DetectedTargets is { Count: > 0 })
            {
                DetectStatusText = BuildDetectStatusText(CountDetectedInstances(response.DetectedTargets), DateTimeOffset.Now);
                ApplyDetectedTargets(response.DetectedTargets, BuildEnabledDeviceIds());
                MarkDetectFresh();
            }
            else
            {
                DetectStatusText = "探测接口已响应，但未返回新的实例清单。";
                MarkDetectFreshEmpty();
            }

            SetStickyNotice("组件探测已完成，已基于当前本地配置刷新实例清单。");
            await RefreshStateAsync();
        }
        catch (Exception ex)
        {
            SetStickyNotice($"组件探测失败：{ex.Message}");
        }
        finally
        {
            EndBackendAction("detect");
        }
    }

    private async Task PollStateLoopAsync(CancellationToken cancellationToken)
    {
        var viewerPollCounter = 0;
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                var state = await _apiClient.GetStateAsync(cancellationToken);
                if (state is not null)
                {
                    _dispatcherQueue.TryEnqueue(() => ApplyState(state));
                }
                else
                {
                    await HandleBackendUnavailableAsync(cancellationToken);
                }
            }
            catch
            {
                await HandleBackendUnavailableAsync(cancellationToken);
            }

            try
            {
                var remoteState = await _apiClient.GetRemoteStateAsync(ServerUrl, Secret, DeviceId, cancellationToken);
                if (remoteState is not null)
                {
                    _dispatcherQueue.TryEnqueue(() => ApplyRemoteState(remoteState));
                }
            }
            catch
            {
                _dispatcherQueue.TryEnqueue(() => RemoteDataStatusText = "中枢暂未返回本机最新数据。请先验证连接或启动监测。");
            }

            viewerPollCounter++;
            if (viewerPollCounter % 5 == 0)
            {
                if (!ViewerSessionReady)
                {
                    await LoginViewerAsync();
                }
                else
                {
                    try
                    {
                        var devices = await _apiClient.GetViewerDevicesAsync(ServerUrl, cancellationToken);
                        _dispatcherQueue.TryEnqueue(() => ApplyViewerDevices(devices));
                    }
                    catch
                    {
                        _dispatcherQueue.TryEnqueue(() =>
                        {
                            ViewerSessionReady = false;
                            ViewerDataStatusText = "无法连接中枢系统。请检查服务器配置和网络连接。";
                        });
                    }
                }
            }

            try
            {
                await Task.Delay(2_000, cancellationToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private async Task LoginViewerAsync()
    {
        if (!HasConnectionConfig || !ServerUrlPolicy.IsAllowed(ServerUrl))
        {
            ViewerSessionReady = false;
            ViewerDataStatusText = "无法连接中枢系统。请先在服务器配置中保存有效地址和 Agent 密钥。";
            return;
        }

        ViewerDataStatusText = "正在连接中枢系统…";
        try
        {
            await _apiClient.LoginViewerAsync(ServerUrl, Secret);
            var devices = await _apiClient.GetViewerDevicesAsync(ServerUrl);
            ApplyViewerDevices(devices);

            ViewerSessionReady = true;
            ViewerDataStatusText = $"中枢已连接，共 {ViewerDevices.Count} 台设备。";
        }
        catch
        {
            ViewerSessionReady = false;
            ViewerDevices.Clear();
            ViewerDataStatusText = "无法连接中枢系统。请检查服务器地址、Agent 密钥和网络连接。";
        }
    }

    private void ApplyViewerDevices(IReadOnlyList<ViewerDeviceSummaryDto> devices)
    {
        ViewerDevices.Clear();
        _viewerDeviceCache.Clear();
        foreach (var device in devices)
        {
            _viewerDeviceCache.Add(new ViewerDeviceItemViewModel(device));
        }

        foreach (var device in _viewerDeviceCache)
        {
            ViewerDevices.Add(device);
        }

        ApplyViewerFilter();

        if (string.IsNullOrWhiteSpace(_selectedViewerDeviceId) && ViewerDevices.Count > 0)
        {
            _ = SelectViewerDeviceAsync(ViewerDevices[0].DeviceId);
        }

        ViewerDataStatusText = $"已登录，共 {ViewerDevices.Count} 台设备。列表每 10 秒刷新。";
    }

    private void ApplyViewerFilter()
    {
        var filter = ViewerDeviceFilter.Trim();
        FilteredViewerDevices.Clear();
        foreach (var device in _viewerDeviceCache.Where(item =>
                     string.IsNullOrWhiteSpace(filter) ||
                     item.Hostname.Contains(filter, StringComparison.OrdinalIgnoreCase) ||
                     item.DeviceId.Contains(filter, StringComparison.OrdinalIgnoreCase)))
        {
            FilteredViewerDevices.Add(device);
        }
    }

    public async Task SelectViewerDeviceAsync(string deviceId)
    {
        if (!ViewerSessionReady || string.IsNullOrWhiteSpace(deviceId))
        {
            return;
        }

        _selectedViewerDeviceId = deviceId;
        SelectedViewerDeviceName = _viewerDeviceCache.FirstOrDefault(item => item.DeviceId == deviceId)?.Hostname ?? deviceId;
        await RefreshSelectedViewerDeviceAsync();
    }

    public async Task RefreshSelectedViewerDeviceAsync()
    {
        if (!ViewerSessionReady || string.IsNullOrWhiteSpace(_selectedViewerDeviceId))
        {
            return;
        }

        var deviceId = _selectedViewerDeviceId;
        ViewerDetailStatusText = $"正在读取 {deviceId} 的 {SelectedMetricWindow} 详细数据…";
        try
        {
            var payload = await _apiClient.GetViewerDeviceMetricsAsync(ServerUrl, deviceId, SelectedMetricWindow);
            if (payload is null)
            {
                ViewerDetailStatusText = "中枢没有返回该设备的详细数据。";
                return;
            }

            var latest = payload.Latest;
            var memoryPercent = latest.MemoryTotalBytes > 0 ? latest.MemoryUsedBytes / latest.MemoryTotalBytes * 100 : 0;
            var diskPercent = latest.DiskTotalBytes > 0 ? latest.DiskUsedBytes / latest.DiskTotalBytes * 100 : 0;
            var gpu = latest.Gpus.FirstOrDefault();
            ViewerDetailStatusText = $"{(payload.Status == "online" ? "在线" : "离线")} · 最近更新 {payload.LastSeenAt}";
            ViewerDetailMemoryText = $"内存：{FormatBytes(latest.MemoryUsedBytes)} / {FormatBytes(latest.MemoryTotalBytes)} ({memoryPercent:0.0}%)";
            ViewerDetailDiskText = $"磁盘：{FormatBytes(latest.DiskUsedBytes)} / {FormatBytes(latest.DiskTotalBytes)} ({diskPercent:0.0}%)";
            ViewerDetailCpuText = $"CPU：使用率 {latest.CpuUsagePercent:0.0}% · {(latest.CpuTemperatureC.HasValue ? $"温度 {latest.CpuTemperatureC:0.0}°C" : "温度 --")}";
            ViewerCpuUsagePercent = Math.Clamp(latest.CpuUsagePercent, 0, 100);
            ViewerMemoryUsagePercent = Math.Clamp(memoryPercent, 0, 100);
            ViewerDiskUsagePercent = Math.Clamp(diskPercent, 0, 100);
            ViewerGpuUsagePercent = Math.Clamp(gpu?.UtilizationPercent ?? 0, 0, 100);
            ViewerNetworkUsagePercent = Math.Clamp((latest.NetworkRxBytesPerSec + latest.NetworkTxBytesPerSec) / (1024 * 1024) * 10, 0, 100);
            ViewerDetailGpuText = gpu is null ? "显卡：暂无数据" : $"显卡：{gpu.Name} {gpu.UtilizationPercent:0.0}%";
            ViewerDetailNetworkText = $"网络：↑ {FormatRate(latest.NetworkTxBytesPerSec)} · ↓ {FormatRate(latest.NetworkRxBytesPerSec)}";
            ViewerDetailFanText = payload.Series.Fans.Count == 0 ? "风扇：暂无数据" : $"风扇：{payload.Series.Fans.Count} 个";
            ReplaceTrend(ViewerCpuTrendPoints, payload.Series.CpuUsagePercent);
            ReplaceTrend(ViewerMemoryTrendPoints, payload.Series.MemoryUsagePercent);
            ReplaceTrend(ViewerDiskTrendPoints, payload.Series.DiskUsagePercent);
            ReplaceTrend(ViewerGpuTrendPoints, payload.Series.GpuUsagePercent);
            ReplaceRelativeTrend(ViewerNetworkTrendPoints, payload.Series.NetworkRxBytesPerSec, payload.Series.NetworkTxBytesPerSec);
            EnsureTrendFallback(ViewerCpuTrendPoints, latest.CpuUsagePercent);
            EnsureTrendFallback(ViewerMemoryTrendPoints, memoryPercent);
            EnsureTrendFallback(ViewerDiskTrendPoints, diskPercent);
            EnsureTrendFallback(ViewerGpuTrendPoints, gpu?.UtilizationPercent ?? 0);
            EnsureTrendFallback(ViewerNetworkTrendPoints, ViewerNetworkUsagePercent);
            ReplaceScaledTrend(ViewerFanTrendPoints, payload.Series.Fans.SelectMany(fan => fan.Rpm));
            BuildViewerDetailCharts(payload.Series, payload.Latest, payload.EnabledMetrics, payload.AvailableMetrics);
        }
        catch (Exception ex)
        {
            ViewerDetailStatusText = $"读取设备详情失败：{ex.Message}";
        }
    }

    private static void ReplaceTrend(
        ObservableCollection<TrendPointViewModel> target,
        IReadOnlyList<ViewerSamplePointDto> source)
    {
        target.Clear();
        foreach (var point in source.TakeLast(32))
        {
            target.Add(new TrendPointViewModel(Math.Clamp(point.Value, 0, 100), point.Timestamp));
        }
    }

    private void BuildViewerDetailCharts(
        ViewerSeriesDto series,
        ViewerLatestMetricsDto latest,
        IReadOnlyCollection<string> enabledMetrics,
        IReadOnlyCollection<ViewerMetricAvailabilityDto> availableMetrics)
    {
        ReplaceCharts(ViewerCpuCharts, IsViewerCategoryVisible(enabledMetrics, availableMetrics, "cpuUsage", "cpuFrequency", "cpuTemperature") ? new[]
        {
            Chart("总 CPU", "使用率", series.CpuUsagePercent, ViewerMetricValueKind.Percent),
            Chart("总 CPU", "频率", series.CpuFrequencyMHz, ViewerMetricValueKind.Megahertz),
            Chart("总 CPU", "温度", series.CpuTemperatureC, ViewerMetricValueKind.Celsius)
        }.Concat(series.Cpus.SelectMany(cpu => new[]
        {
            Chart(cpu.Name, CpuSubtitle(cpu), "使用率", cpu.UsagePercent, ViewerMetricValueKind.Percent),
            Chart(cpu.Name, CpuSubtitle(cpu), "频率", cpu.FrequencyMHz, ViewerMetricValueKind.Megahertz),
            Chart(cpu.Name, CpuSubtitle(cpu), "温度", cpu.TemperatureC, ViewerMetricValueKind.Celsius)
        })) : Array.Empty<ViewerDetailChartViewModel>());

        ReplaceCharts(ViewerMemoryCharts, IsViewerCategoryVisible(enabledMetrics, availableMetrics, "memoryUsage", "swapUsage") ? new[]
        {
            Chart("内存", $"物理内存 {FormatBytes(latest.MemoryUsedBytes)} / {FormatBytes(latest.MemoryTotalBytes)}", "使用率", series.MemoryUsagePercent, ViewerMetricValueKind.Percent),
            Chart("内存", $"物理内存总计 {FormatBytes(latest.MemoryTotalBytes)}", "已用容量", series.MemoryUsedBytes, ViewerMetricValueKind.Bytes),
            Chart("内存", $"交换分区 {FormatBytes(latest.SwapUsedBytes)} / {FormatBytes(latest.SwapTotalBytes)}", "使用率", series.SwapUsagePercent, ViewerMetricValueKind.Percent),
            Chart("内存", $"交换分区总计 {FormatBytes(latest.SwapTotalBytes)}", "已用容量", series.SwapUsedBytes, ViewerMetricValueKind.Bytes)
        } : Array.Empty<ViewerDetailChartViewModel>());

        ReplaceCharts(ViewerDiskCharts, IsViewerCategoryVisible(enabledMetrics, availableMetrics, "diskUsage", "diskRead", "diskWrite") ? new[]
        {
            Chart("全部磁盘", $"已用 {FormatBytes(latest.DiskUsedBytes)} / {FormatBytes(latest.DiskTotalBytes)}", "总占用", series.DiskUsagePercent, ViewerMetricValueKind.Percent),
            Chart("全部磁盘", $"总计 {FormatBytes(latest.DiskTotalBytes)}", "已用容量", series.DiskUsedBytes, ViewerMetricValueKind.Bytes),
            Chart("全部磁盘", "读取", series.DiskReadBytesPerSec, ViewerMetricValueKind.Rate),
            Chart("全部磁盘", "写入", series.DiskWriteBytesPerSec, ViewerMetricValueKind.Rate)
        }.Concat(series.Disks.SelectMany(disk => new[]
        {
            Chart(disk.Name, DiskSubtitle(disk, latest.Disks.FirstOrDefault(candidate => candidate.Id == disk.Id)), "占用", disk.UsagePercent, ViewerMetricValueKind.Percent),
            Chart(disk.Name, DiskSubtitle(disk, latest.Disks.FirstOrDefault(candidate => candidate.Id == disk.Id)), "读取", disk.ReadBytesPerSec, ViewerMetricValueKind.Rate),
            Chart(disk.Name, DiskSubtitle(disk, latest.Disks.FirstOrDefault(candidate => candidate.Id == disk.Id)), "写入", disk.WriteBytesPerSec, ViewerMetricValueKind.Rate)
        })) : Array.Empty<ViewerDetailChartViewModel>());

        ReplaceCharts(ViewerGpuCharts, IsViewerCategoryVisible(enabledMetrics, availableMetrics, "gpuUsage", "gpuEncode", "gpuDecode", "gpuFrequency", "gpuMemory", "gpuTemperature") ? new[]
        {
            Chart("全部显卡", "总占用", series.GpuUsagePercent, ViewerMetricValueKind.Percent),
            Chart("全部显卡", "编码", series.GpuEncodePercent, ViewerMetricValueKind.Percent),
            Chart("全部显卡", "解码", series.GpuDecodePercent, ViewerMetricValueKind.Percent),
            Chart("全部显卡", "频率", series.GpuFrequencyMHz, ViewerMetricValueKind.Megahertz),
            Chart("全部显卡", "显存占用", series.GpuMemoryUsagePercent, ViewerMetricValueKind.Percent),
            Chart("全部显卡", "温度", series.GpuTemperatureC, ViewerMetricValueKind.Celsius)
        }.Concat(series.Gpus.SelectMany(gpuSeries => new[]
        {
            Chart(gpuSeries.Name, "使用率", gpuSeries.UsagePercent, ViewerMetricValueKind.Percent),
            Chart(gpuSeries.Name, "编码", gpuSeries.EncodePercent, ViewerMetricValueKind.Percent),
            Chart(gpuSeries.Name, "解码", gpuSeries.DecodePercent, ViewerMetricValueKind.Percent),
            Chart(gpuSeries.Name, "频率", gpuSeries.FrequencyMHz, ViewerMetricValueKind.Megahertz),
            Chart(gpuSeries.Name, "显存占用", gpuSeries.MemoryUsagePercent, ViewerMetricValueKind.Percent),
            Chart(gpuSeries.Name, "温度", gpuSeries.TemperatureC, ViewerMetricValueKind.Celsius)
        })) : Array.Empty<ViewerDetailChartViewModel>());

        ReplaceCharts(ViewerNetworkCharts, IsViewerCategoryVisible(enabledMetrics, availableMetrics, "networkRxRate", "networkTxRate", "networkTraffic") ? new[]
        {
            Chart("全部网络", "接收", series.NetworkRxBytesPerSec, ViewerMetricValueKind.Rate),
            Chart("全部网络", "发送", series.NetworkTxBytesPerSec, ViewerMetricValueKind.Rate),
            Chart("全部网络", "累计接收", series.TrafficRxBytes, ViewerMetricValueKind.Bytes),
            Chart("全部网络", "累计发送", series.TrafficTxBytes, ViewerMetricValueKind.Bytes)
        }.Concat(series.Networks.SelectMany(network => new[]
        {
            Chart(network.Name, NetworkSubtitle(network), "接收", network.RxBytesPerSec, ViewerMetricValueKind.Rate),
            Chart(network.Name, NetworkSubtitle(network), "发送", network.TxBytesPerSec, ViewerMetricValueKind.Rate),
            Chart(network.Name, NetworkSubtitle(network), "累计接收", network.TrafficRxBytes, ViewerMetricValueKind.Bytes),
            Chart(network.Name, NetworkSubtitle(network), "累计发送", network.TrafficTxBytes, ViewerMetricValueKind.Bytes)
        })) : Array.Empty<ViewerDetailChartViewModel>());

        // Fan collection is controlled by the fan probe rather than enabledMetrics.
        ReplaceCharts(ViewerFanCharts, series.Fans.Select(fan =>
            Chart(fan.Name, fan.Interface ?? "", "转速", fan.Rpm, ViewerMetricValueKind.Rpm)));

        HasViewerCpuCharts = ViewerCpuCharts.Count > 0;
        HasViewerMemoryCharts = ViewerMemoryCharts.Count > 0;
        HasViewerDiskCharts = ViewerDiskCharts.Count > 0;
        HasViewerGpuCharts = ViewerGpuCharts.Count > 0;
        HasViewerNetworkCharts = ViewerNetworkCharts.Count > 0;
        HasViewerFanCharts = ViewerFanCharts.Count > 0;
    }

    private static bool IsViewerCategoryVisible(
        IReadOnlyCollection<string> enabledMetrics,
        IReadOnlyCollection<ViewerMetricAvailabilityDto> availableMetrics,
        params string[] categoryMetrics)
    {
        var isEnabled = enabledMetrics.Count == 0 || categoryMetrics.Any(metric => enabledMetrics.Contains(metric, StringComparer.OrdinalIgnoreCase));
        var isAvailable = availableMetrics.Count == 0 || categoryMetrics.Any(metric =>
            availableMetrics.Any(candidate => candidate.Key.Equals(metric, StringComparison.OrdinalIgnoreCase) && candidate.Available));
        return isEnabled && isAvailable;
    }

    private static ViewerDetailChartViewModel Chart(string title, string metric, IReadOnlyList<ViewerSamplePointDto> points, ViewerMetricValueKind kind)
        => Chart(title, "", metric, points, kind);

    private static ViewerDetailChartViewModel Chart(string title, string subtitle, string metric, IReadOnlyList<ViewerSamplePointDto> points, ViewerMetricValueKind kind)
        => new(title, subtitle, metric, points, kind);

    private static void ReplaceCharts(ObservableCollection<ViewerDetailChartViewModel> target, IEnumerable<ViewerDetailChartViewModel> charts)
    {
        target.Clear();
        foreach (var chart in charts.Where(chart => chart.Points.Count > 0))
        {
            target.Add(chart);
        }
    }

    private static string CpuSubtitle(ViewerCpuMetricSeriesDto cpu)
        => string.Join(" · ", new[]
        {
            cpu.CoreCount.HasValue ? $"{cpu.CoreCount.Value} 核" : null,
            cpu.LogicalCount.HasValue ? $"{cpu.LogicalCount.Value} 线程" : null
        }.Where(value => !string.IsNullOrWhiteSpace(value)).Select(value => value!));

    private static string DiskSubtitle(ViewerDiskMetricSeriesDto disk, ViewerDiskDto? latest)
    {
        var usage = latest is not null && latest.TotalBytes > 0
            ? $"{FormatBytes(latest.UsedBytes)} / {FormatBytes(latest.TotalBytes)}"
            : null;
        return string.Join(" · ", new[] { disk.MountPoint, usage, disk.Model, disk.Filesystem }
            .Where(value => !string.IsNullOrWhiteSpace(value)).Select(value => value!));
    }

    private static string NetworkSubtitle(ViewerNetworkMetricSeriesDto network)
        => string.Join(" · ", new[] { network.MacAddress, string.Join(", ", network.Ipv4) }.Where(value => !string.IsNullOrWhiteSpace(value)).Select(value => value!));

    private static void EnsureTrendFallback(ObservableCollection<TrendPointViewModel> target, double value)
    {
        if (target.Count == 0)
        {
            target.Add(new TrendPointViewModel(Math.Clamp(value, 0, 100), DateTimeOffset.UtcNow.ToString("O")));
        }
    }

    private static void ReplaceRelativeTrend(
        ObservableCollection<TrendPointViewModel> target,
        IReadOnlyList<ViewerSamplePointDto> received,
        IReadOnlyList<ViewerSamplePointDto> sent)
    {
        var values = received
            .Concat(sent)
            .GroupBy(point => point.Timestamp, StringComparer.Ordinal)
            .Select(group => new { Timestamp = group.Key, Value = group.Sum(point => Math.Max(0, point.Value)) })
            .TakeLast(32)
            .ToList();
        var peak = values.Count == 0 ? 0 : values.Max(point => point.Value);

        target.Clear();
        foreach (var point in values)
        {
            target.Add(new TrendPointViewModel(peak > 0 ? point.Value / peak * 100 : 0, point.Timestamp));
        }
    }

    private static void ReplaceScaledTrend(ObservableCollection<TrendPointViewModel> target, IEnumerable<ViewerSamplePointDto> source)
    {
        var points = source.TakeLast(32).ToList();
        var maximum = points.Count == 0 ? 0 : points.Max(point => point.Value);
        target.Clear();
        foreach (var point in points)
        {
            target.Add(new TrendPointViewModel(maximum > 0 ? point.Value / maximum * 100 : 0, point.Timestamp));
        }
    }

    private void ApplyRemoteState(AgentRemoteStateDto state)
    {
        var latest = state.Latest;
        var memoryPercent = latest.Memory.TotalBytes > 0
            ? latest.Memory.UsedBytes / latest.Memory.TotalBytes * 100
            : 0;
        var diskPercent = latest.DiskUsage.TotalBytes > 0
            ? latest.DiskUsage.UsedBytes / latest.DiskUsage.TotalBytes * 100
            : 0;
        var gpu = latest.Gpus.FirstOrDefault();
        RemoteDataStatusText = $"{(state.Status == "online" ? "在线" : "离线")} · 最近更新 {state.LastSeenAt}";
        RemoteCpuText = $"CPU {latest.CpuUsagePercent:0.0}%";
        RemoteMemoryText = $"内存 {memoryPercent:0.0}%";
        RemoteDiskText = $"磁盘 {diskPercent:0.0}%";
        RemoteNetworkText = $"网络 ↑ {FormatRate(latest.NetworkRate.TxBytesPerSec)} · ↓ {FormatRate(latest.NetworkRate.RxBytesPerSec)}";
        RemoteGpuText = gpu is null
            ? "显卡 暂无数据"
            : $"{gpu.Name} {gpu.UtilizationPercent:0.0}%";
        LocalSampleTimestampText = string.IsNullOrWhiteSpace(latest.Timestamp)
            ? $"上次数据获取时间：{state.LastSeenAt}"
            : $"上次数据获取时间：{latest.Timestamp}";
        LocalCpuPayloadText = latest.CpuPackages.Count == 0
            ? "CPU：尚未收到 CPU 包明细；请确认 CPU 使用率指标已启用。"
            : string.Join("\n", latest.CpuPackages.Select(cpu =>
                $"{cpu.Model} · {cpu.CoreCount ?? 0} 核 / {cpu.LogicalCount ?? 0} 线程 · {cpu.UsagePercent ?? latest.CpuUsagePercent:0.0}% · {cpu.FrequencyMHz ?? 0:0} MHz"));
        LocalMemoryPayloadText = $"已用 {FormatBytes(latest.Memory.UsedBytes)} / 总计 {FormatBytes(latest.Memory.TotalBytes)}";
        LocalDiskPayloadText = latest.Disks.Count == 0
            ? "磁盘：尚未收到实例明细。"
            : $"共 {latest.Disks.Count} 块\n" + string.Join("\n", latest.Disks.Select(disk =>
                $"{disk.Name} {disk.MountPoint} · 已用 {FormatBytes(disk.UsedBytes)} / {FormatBytes(disk.TotalBytes)} · {disk.Model}"));
        LocalNetworkPayloadText = latest.NetworkInterfaces.Count == 0
            ? "网卡：尚未收到实例明细。"
            : $"共 {latest.NetworkInterfaces.Count} 张\n" + string.Join("\n", latest.NetworkInterfaces.Select(network =>
                $"{network.Name} · {string.Join(", ", network.Ipv4)} · ↑ {FormatRate(network.TxBytesPerSec ?? 0)} / ↓ {FormatRate(network.RxBytesPerSec ?? 0)}"));
    }

    private static void EnableDefaultMetrics(IEnumerable<MetricToggleItemViewModel> metrics)
    {
        foreach (var metric in metrics)
        {
            metric.SetIsEnabledSilently(true);
        }
    }

    private static string FormatBytes(double value)
    {
        if (value >= 1024 * 1024 * 1024) return $"{value / 1024 / 1024 / 1024:0.00} GB";
        if (value >= 1024 * 1024) return $"{value / 1024 / 1024:0.0} MB";
        return $"{value / 1024:0.0} KB";
    }

    private static string FormatRate(double bytesPerSecond)
    {
        if (bytesPerSecond >= 1024 * 1024)
        {
            return $"{bytesPerSecond / 1024 / 1024:0.0} MB/s";
        }

        return $"{bytesPerSecond / 1024:0.0} KB/s";
    }

    private async Task TryAttachFrontendOwnershipAsync()
    {
        try
        {
            await _apiClient.AttachFrontendAsync(Environment.ProcessId, _pollingCts?.Token ?? CancellationToken.None);
            _isUsingSharedBackend = false;
        }
        catch
        {
        }
    }

    private void ResetBackendAvailabilityTracking()
    {
        _backendFailureCount = 0;
        _backendRecoveryAttemptCount = 0;
        _backendUnavailableSince = null;
    }

    private void MarkBackendRecovered()
    {
        var attempts = Math.Max(1, _backendRecoveryAttemptCount);
        _backendRecoveryStatusCode = "recovered";
        BackendRecoveryText = $"本地 backend 已恢复响应，WinUI 最近一次共尝试 {attempts} 次恢复。";
        BackendRecoveryDetailText = $"恢复时间：{DateTimeOffset.Now:yyyy-MM-dd HH:mm:ss}。前端会继续监控本地 backend，若再次离线会重新拉起或重启。";
        RaiseStatusSummaryChanged();
    }

    private Task HandleBackendUnavailableAsync(CancellationToken cancellationToken)
    {
        _backendFailureCount++;
        _backendUnavailableSince ??= DateTimeOffset.UtcNow;
        if (_backendFailureCount < BackendUnavailableConfirmationThreshold)
        {
            return Task.CompletedTask;
        }

        _dispatcherQueue.TryEnqueue(UpdateBackendUnavailablePresentation);

        if (_isShuttingDown || cancellationToken.IsCancellationRequested)
        {
            return Task.CompletedTask;
        }

        var now = DateTimeOffset.UtcNow;
        if (now - _lastBackendRecoveryAttemptAt < BackendRecoveryCooldown)
        {
            return Task.CompletedTask;
        }

        _lastBackendRecoveryAttemptAt = now;

        try
        {
            if (_backendFailureCount >= BackendRestartFailureThreshold && _hostService.IsManagedProcessRunning)
            {
                _hostService.Restart();
            }
            else
            {
                _hostService.EnsureStarted();
            }

            _isUsingSharedBackend = _hostService.IsAttachedToExistingBackend;
            _backendRecoveryAttemptCount++;
            _dispatcherQueue.TryEnqueue(() =>
            {
                SetStatusNotice(_backendFailureCount >= BackendRestartFailureThreshold
                    ? $"检测到本地 backend 持续无响应，WinUI 已发起第 {_backendRecoveryAttemptCount} 次重启恢复。"
                    : _isUsingSharedBackend
                        ? $"检测到已有本地 backend 恢复可用，WinUI 已在第 {_backendRecoveryAttemptCount} 次恢复尝试中重新附着。"
                        : $"检测到本地 backend 暂时离线，WinUI 已发起第 {_backendRecoveryAttemptCount} 次拉起恢复。");
                UpdateBackendUnavailablePresentation();
            });
        }
        catch (Exception ex)
        {
            _dispatcherQueue.TryEnqueue(() =>
            {
                SetStickyNotice($"本地 Go backend 自恢复失败：{ex.Message}");
                UpdateBackendUnavailablePresentation();
            });
        }

        return Task.CompletedTask;
    }

    private void UpdateBackendUnavailablePresentation()
    {
        _backendReachable = false;
        _backendRunning = false;
        _connectionStatusCode = "offline";
        var offlineSinceText = _backendUnavailableSince.HasValue
            ? $"最近一次失联开始于 {_backendUnavailableSince.Value.ToLocalTime():yyyy-MM-dd HH:mm:ss}。"
            : "最近一次失联时间待确认。";
        var recoveryText = _backendRecoveryAttemptCount > 0
            ? $"WinUI 已发起 {_backendRecoveryAttemptCount} 次本地 backend 自恢复尝试。"
            : "WinUI 正在等待本地 backend 恢复响应。";
        _backendRecoveryStatusCode = _backendRecoveryAttemptCount > 0 ? "recovering" : "waiting";

        StatusText = "本地控制后端未响应";
        ConnectionText = "正在等待 127.0.0.1:17891 恢复。";
        LocalBackendStateText = $"本地 Go backend 当前不可达。{offlineSinceText} {recoveryText}";
        CollectorStateText = "由于本地 backend 尚未恢复，当前无法确认采集器状态。";
        RealtimeControlText = "中枢实时控制通道状态暂不可用，等待本地 backend 恢复后重新确认。";
        _controlStreamStatusCode = "waiting";
        ControlStreamStateText = "实时控制链路状态暂不可用，正在等待本地 backend 恢复。";
        ControlStreamLastEventText = "最近推送：等待 backend 恢复后重新确认。";
        ControlStreamLastDisconnectText = "最近断开：等待 backend 恢复后重新确认。";
        ControlStreamReconnectText = "主动重连：等待 backend 恢复后重新确认。";
        ControlStreamHealthText = "链路健康度：等待 backend 恢复后重新确认。";
        ControlStreamCategoryText = "问题类别：本地控制链路恢复中。";
        ControlStreamErrorText = "断开原因：等待 backend 恢复后重新确认。";
        ControlStreamActionText = "建议操作：先等待本地 backend 恢复；恢复后会自动重试主动推送链路。";
        ControlStreamTransportText = "控制方式：本地 backend 恢复后会重新尝试建立主动推送链路，失败时回退到低频轮询。";
        BackendRecoveryText = _backendRecoveryAttemptCount > 0
            ? $"WinUI 正在自动恢复本地 backend，当前已尝试 {_backendRecoveryAttemptCount} 次。"
            : "WinUI 已进入本地 backend 等待恢复状态。";
        BackendRecoveryDetailText = $"{offlineSinceText} {recoveryText}";
        LastLogText = _backendRecoveryAttemptCount > 0
            ? $"最近日志：本地 backend 当前不可达，已触发 {_backendRecoveryAttemptCount} 次前端自恢复。"
            : "最近日志：本地 backend 当前不可达。";
        _hasActiveUploadIssue = false;
        _lastUploadAtText = "";
        RaiseStatusSummaryChanged();
    }

    private void ApplyState(BackendStateDto state)
    {
        var hadTransientFailure = _backendFailureCount > 0 || _backendRecoveryAttemptCount > 0 || _backendUnavailableSince.HasValue;
        var hadConfirmedBackendOutage =
            _backendFailureCount >= BackendUnavailableConfirmationThreshold ||
            _backendRecoveryAttemptCount > 0;

        if (hadTransientFailure)
        {
            if (hadConfirmedBackendOutage)
            {
                MarkBackendRecovered();
            }
            ResetBackendAvailabilityTracking();
        }

        _isApplyingState = true;
        try
        {
            _backendReachable = true;
            _backendRunning = state.Running;
            _connectionStatusCode = string.IsNullOrWhiteSpace(state.ConnectionStatus) ? "stopped" : state.ConnectionStatus;
            _lastUploadAtText = state.LastUploadAt ?? "";
            _hasCloudSyncAttempt = !string.IsNullOrWhiteSpace(state.LastCloudSyncAt);
            _lastCloudSyncSucceeded = _hasCloudSyncAttempt && string.IsNullOrWhiteSpace(state.LastCloudSyncError);
            _lastCloudSyncAtText = state.LastCloudSyncAt ?? "";
            _lastCloudSyncErrorText = state.LastCloudSyncError ?? "";
            _cloudPushPending = state.CloudConfigPending;
            _frontendParentPid = state.FrontendParentPid;
            _configFileExists = state.ConfigFileExists;
            _syncStateFileExists = state.SyncStateFileExists;
            _diagnosticsFileExists = state.DiagnosticsFileExists;
            StatusText = state.Running
                ? $"采集器运行中，配置文件：{state.ConfigPath}"
                : "本地后端在线，采集器未运行";
            ConnectionText = BuildConnectionText(state);
            LocalBackendStateText = BuildLocalBackendStateText(state);
            CollectorStateText = BuildCollectorStateText(state);
            LastLogText = string.IsNullOrWhiteSpace(state.LastChildLog)
                ? "最近日志：暂无。"
                : $"最近日志：{state.LastChildLog}";
            UpdateCloudSyncPresentation();
            ConfigPathText = BuildArtifactPathText("配置文件", state.ConfigPath, state.ConfigFileExists);
            SyncStatePathText = BuildArtifactPathText("同步状态文件", state.SyncStatePath, state.SyncStateFileExists);
            DiagnosticsPathText = BuildArtifactPathText("诊断日志", state.DiagnosticsPath, state.DiagnosticsFileExists);
            IssueSummaryText = string.IsNullOrWhiteSpace(state.LastIssueCategory)
                ? "最近异常分类：暂无。"
                : state.LastIssueCount > 0
                    ? string.IsNullOrWhiteSpace(state.LastIssueAt)
                        ? $"最近异常分类：{ResolveIssueCategoryLabel(state.LastIssueCategory)}（{state.LastIssueCategory}），连续 {Math.Max(1, state.LastIssueCount)} 次，{state.LastIssueDetail}"
                        : $"最近异常分类：{ResolveIssueCategoryLabel(state.LastIssueCategory)}（{state.LastIssueCategory}），时间 {state.LastIssueAt}，连续 {Math.Max(1, state.LastIssueCount)} 次，{state.LastIssueDetail}"
                    : string.IsNullOrWhiteSpace(state.LastIssueRecoveredAt)
                        ? $"最近异常分类：{ResolveIssueCategoryLabel(state.LastIssueCategory)}（{state.LastIssueCategory}），最近一次为 {state.LastIssueAt}，当前已恢复。"
                        : $"最近异常分类：{ResolveIssueCategoryLabel(state.LastIssueCategory)}（{state.LastIssueCategory}），最近一次为 {state.LastIssueAt}，已于 {state.LastIssueRecoveredAt} 恢复。";
            _hasActiveUploadIssue =
                string.Equals(state.LastIssueCategory, "upload", StringComparison.OrdinalIgnoreCase) &&
                state.LastIssueCount > 0 &&
                string.IsNullOrWhiteSpace(state.LastIssueRecoveredAt);

            // Keep the user's in-progress connection edit from being overwritten by polling.
            if (!_localSavePending)
            {
                ServerUrl = state.Config.Connection.ServerUrl;
                Secret = state.Config.Connection.Secret;
                DeviceId = state.Config.Connection.DeviceId;
                Hostname = state.Config.Connection.Hostname;
            }
            // A poll must never replace a value the user has just changed but that is still
            // waiting for the debounced backend save. It also keeps an open ComboBox stable.
            if (!_localSavePending)
            {
                NormalIntervalSeconds = state.Config.Sampling.NormalIntervalSeconds;
                FastIntervalSeconds = state.Config.Sampling.FastIntervalSeconds;
                SlowIntervalSeconds = state.Config.Sampling.SlowIntervalSeconds;
                ViewerRealtimeHoldSeconds = state.Config.Sampling.ViewerRealtimeHoldSeconds;
                RealtimeModeEnabled = state.RealtimeModeEnabled;
                _realtimeModeExpiresAt = state.RealtimeModeExpiresAt ?? "";
                _realtimeModeSource = state.RealtimeModeSource ?? "";
                CloudSyncEnabled = state.Config.CloudSyncEnabled;
                DataRecordingEnabled = state.Config.DataRecordingEnabled;
                AutoRestartCollector = state.Config.AutoRestartCollector;
                AutoStartCollector = state.Config.AutoStartCollector;
                CopyEnabledDeviceIds(state.Config.EnabledDeviceIds);
                CopyInstanceMetricConfig(state.Config.InstanceMetricConfig);
                ApplyEnabledMetrics(state.Config.EnabledMetrics);
                ApplySupportedPlans(state.SupportedProbePlans);
                CpuProvider = ResolveSupportedProvider(state.Config.ProbeSelections, "cpu", CpuProviderOptions);
                MemoryProvider = ResolveSupportedProvider(state.Config.ProbeSelections, "memory", MemoryProviderOptions);
                DiskProvider = ResolveSupportedProvider(state.Config.ProbeSelections, "disk", DiskProviderOptions);
                NetworkProvider = ResolveSupportedProvider(state.Config.ProbeSelections, "network", NetworkProviderOptions);
                GpuProvider = ResolveSupportedProvider(state.Config.ProbeSelections, "gpu", GpuProviderOptions);
                FanProvider = ResolveSupportedProvider(state.Config.ProbeSelections, "fan", FanProviderOptions);
                CpuEnabled = IsProbeEnabled(state.Config.ProbeSelections, "cpu") && !string.Equals(CpuProvider, "disabled", StringComparison.OrdinalIgnoreCase);
                MemoryEnabled = IsProbeEnabled(state.Config.ProbeSelections, "memory") && !string.Equals(MemoryProvider, "disabled", StringComparison.OrdinalIgnoreCase);
                DiskEnabled = IsProbeEnabled(state.Config.ProbeSelections, "disk") && !string.Equals(DiskProvider, "disabled", StringComparison.OrdinalIgnoreCase);
                NetworkEnabled = IsProbeEnabled(state.Config.ProbeSelections, "network") && !string.Equals(NetworkProvider, "disabled", StringComparison.OrdinalIgnoreCase);
                GpuEnabled = IsProbeEnabled(state.Config.ProbeSelections, "gpu") && !string.Equals(GpuProvider, "disabled", StringComparison.OrdinalIgnoreCase);
                FanEnabled = IsProbeEnabled(state.Config.ProbeSelections, "fan") && !string.Equals(FanProvider, "disabled", StringComparison.OrdinalIgnoreCase);
                ApplyDetectedTargets(state.DetectedTargets, state.Config.EnabledDeviceIds);
            }
            RealtimeStatusText = BuildRealtimeStatusText(state);
            RealtimeControlText = BuildRealtimeControlText(state);
            _controlStreamStatusCode = ResolveControlStreamStatusCode(state);
            ControlStreamStateText = BuildControlStreamStateText(state);
            ControlStreamLastEventText = BuildControlStreamLastEventText(state);
            ControlStreamLastDisconnectText = BuildControlStreamLastDisconnectText(state);
            ControlStreamReconnectText = BuildControlStreamReconnectText(state);
            ControlStreamHealthText = BuildControlStreamHealthText(state);
            ControlStreamCategoryText = BuildControlStreamCategoryText(state);
            ControlStreamErrorText = BuildControlStreamErrorText(state);
            ControlStreamActionText = BuildControlStreamActionText(state);
            ControlStreamTransportText = BuildControlStreamTransportText(state);
            OnPropertyChanged(nameof(RealtimeButtonText));
            DetectStatusText = BuildDetectStatusText(state);
            SyncDetectFreshnessFromState(state);

            SetStatusNotice(state.Running
                ? "本地控制后端在线，配置变更会自动写入本地文件。"
                : "本地控制后端在线，可以随时启动采集器。");
            RaiseStatusSummaryChanged();
        }
        finally
        {
            _isApplyingState = false;
        }
    }

    private void ApplySupportedPlans(IEnumerable<ProbePlanSupport> plans)
    {
        CpuProviderOptions = KeepEquivalentOptions(CpuProviderOptions, ResolvePlanOptions(plans, "cpu", "builtin"));
        MemoryProviderOptions = KeepEquivalentOptions(MemoryProviderOptions, ResolvePlanOptions(plans, "memory", "builtin"));
        DiskProviderOptions = KeepEquivalentOptions(DiskProviderOptions, ResolvePlanOptions(plans, "disk", "builtin"));
        NetworkProviderOptions = KeepEquivalentOptions(NetworkProviderOptions, ResolvePlanOptions(plans, "network", "builtin"));
        GpuProviderOptions = KeepEquivalentOptions(GpuProviderOptions, ResolvePlanOptions(plans, "gpu", "disabled"));
        FanProviderOptions = KeepEquivalentOptions(FanProviderOptions, ResolvePlanOptions(plans, "fan", "disabled"));

        DetectSummary = $"CPU: {string.Join(", ", CpuProviderOptions.Select(item => item.Label))} | 内存: {string.Join(", ", MemoryProviderOptions.Select(item => item.Label))} | 磁盘: {string.Join(", ", DiskProviderOptions.Select(item => item.Label))} | 网络: {string.Join(", ", NetworkProviderOptions.Select(item => item.Label))} | 显卡: {string.Join(", ", GpuProviderOptions.Select(item => item.Label))} | 风扇: {string.Join(", ", FanProviderOptions.Select(item => item.Label))}";
    }

    private static IReadOnlyList<ProbeProviderOptionViewModel> KeepEquivalentOptions(
        IReadOnlyList<ProbeProviderOptionViewModel> current,
        IReadOnlyList<ProbeProviderOptionViewModel> next)
    {
        return current.Count == next.Count && current.Zip(next).All(pair =>
            string.Equals(pair.First.Key, pair.Second.Key, StringComparison.OrdinalIgnoreCase) &&
            string.Equals(pair.First.Label, pair.Second.Label, StringComparison.Ordinal))
            ? current
            : next;
    }

    private void ApplyDetectedTargets(IEnumerable<ProbeTargetStateDto> targets, IReadOnlyDictionary<string, List<string>> enabledDeviceIds)
    {
        var safeTargets = targets?.ToList() ?? new List<ProbeTargetStateDto>();
        ApplyInstanceCollection(
            CpuInstances,
            safeTargets.FirstOrDefault(item => item.Target == "cpu")?.Instances,
            "cpu",
            enabledDeviceIds);
        ApplyInstanceCollection(
            DiskInstances,
            safeTargets.FirstOrDefault(item => item.Target == "disk")?.Instances,
            "disk",
            enabledDeviceIds);
        ApplyInstanceCollection(
            NetworkInstances,
            safeTargets.FirstOrDefault(item => item.Target == "network")?.Instances,
            "network",
            enabledDeviceIds);
        ApplyInstanceCollection(
            GpuInstances,
            safeTargets.FirstOrDefault(item => item.Target == "gpu")?.Instances,
            "gpu",
            enabledDeviceIds);

        OnPropertyChanged(nameof(HasCpuInstances));
        OnPropertyChanged(nameof(HasDiskInstances));
        OnPropertyChanged(nameof(HasNetworkInstances));
        OnPropertyChanged(nameof(HasGpuInstances));
        CpuInstanceSummary = BuildInstanceSummary("CPU", CpuInstances);
        DiskInstanceSummary = BuildInstanceSummary("磁盘", DiskInstances);
        NetworkInstanceSummary = BuildInstanceSummary("网卡", NetworkInstances);
        GpuInstanceSummary = BuildInstanceSummary("显卡", GpuInstances);
        _cpuGroup.NotifySummaryChanged();
        _diskGroup.NotifySummaryChanged();
        _networkGroup.NotifySummaryChanged();
        _gpuGroup.NotifySummaryChanged();
        SyncSelectedInstanceMetricEditor();
    }

    private void ApplyInstanceCollection(
        ObservableCollection<ProbeInstanceItemViewModel> collection,
        IEnumerable<ProbeDetectedTargetDto>? items,
        string target,
        IReadOnlyDictionary<string, List<string>> enabledDeviceIds)
    {
        collection.Clear();
        var hasExplicitSelection = enabledDeviceIds.ContainsKey(target);
        var enabled = enabledDeviceIds.TryGetValue(target, out var ids)
            ? ids.Where(item => !string.IsNullOrWhiteSpace(item)).ToHashSet(StringComparer.OrdinalIgnoreCase)
            : new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in items ?? [])
        {
            var isEnabled = hasExplicitSelection ? enabled.Contains(item.Id) : item.Enabled;
            collection.Add(new ProbeInstanceItemViewModel(
                target,
                item.Id,
                item.Name,
                item.Subtitle,
                string.Join(" · ", item.Metrics ?? []),
                isEnabled,
                SupportsInstanceMetricEditing(target),
                HandleInstanceToggle));
        }
    }

    private List<string> ResolveEnabledMetrics()
    {
        var metrics = new List<string>();
        AppendSelectedMetrics(metrics, CpuMetricToggles, CpuEnabled);
        AppendSelectedMetrics(metrics, MemoryMetricToggles, MemoryEnabled);
        AppendSelectedMetrics(metrics, DiskMetricToggles, DiskEnabled);
        AppendSelectedMetrics(metrics, NetworkMetricToggles, NetworkEnabled);
        AppendSelectedMetrics(metrics, GpuMetricToggles, GpuEnabled);
        return metrics;
    }

    private Dictionary<string, List<string>> BuildEnabledDeviceIds()
    {
        var result = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in _enabledDeviceIdsDraft)
        {
            result[item.Key] = item.Value
                .Where(id => !string.IsNullOrWhiteSpace(id))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
        }

        MergeInstanceSelection(result, "cpu", CpuInstances);
        MergeInstanceSelection(result, "disk", DiskInstances);
        MergeInstanceSelection(result, "network", NetworkInstances);
        MergeInstanceSelection(result, "gpu", GpuInstances);
        return result;
    }

    private Dictionary<string, List<string>> BuildInstanceMetricConfig()
    {
        var result = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in _instanceMetricConfigDraft)
        {
            var metrics = item.Value
                .Where(metric => !string.IsNullOrWhiteSpace(metric))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
            result[item.Key] = metrics;
        }

        return result;
    }

    private void CopyEnabledDeviceIds(IReadOnlyDictionary<string, List<string>> source)
    {
        _enabledDeviceIdsDraft.Clear();
        foreach (var item in source)
        {
            _enabledDeviceIdsDraft[item.Key] = item.Value.ToList();
        }
    }

    private void CopyInstanceMetricConfig(IReadOnlyDictionary<string, List<string>> source)
    {
        _instanceMetricConfigDraft.Clear();
        foreach (var item in source)
        {
            _instanceMetricConfigDraft[item.Key] = item.Value
                .Where(metric => !string.IsNullOrWhiteSpace(metric))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
        }
    }

    private void ApplyEnabledMetrics(IReadOnlyList<string> source)
    {
        var selected = source
            .Where(metric => !string.IsNullOrWhiteSpace(metric))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        if (selected.Count == 0)
        {
            foreach (var metric in BlockMetrics.Values.SelectMany(item => item))
            {
                selected.Add(metric);
            }
        }

        SyncMetricItems(CpuMetricToggles, selected);
        SyncMetricItems(MemoryMetricToggles, selected);
        SyncMetricItems(DiskMetricToggles, selected);
        SyncMetricItems(NetworkMetricToggles, selected);
        SyncMetricItems(GpuMetricToggles, selected);
        NotifyMetricSummaryChanged();
    }

    private void HandleInstanceToggle(ProbeInstanceItemViewModel item)
    {
        _enabledDeviceIdsDraft[item.Target] = ResolveCollection(item.Target)
            .Where(instance => instance.IsEnabled)
            .Select(instance => instance.Id)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        UpdateCloudSyncPending(true);
        QueueSave();
    }

    private void HandleMetricToggle(MetricToggleItemViewModel item)
    {
        UpdateCloudSyncPending(true);
        NotifyMetricSummaryChanged(item.BlockKey);
        QueueSave();
    }

    private void HandleInstanceMetricToggle(MetricToggleItemViewModel item)
    {
        if (SelectedInstanceMetricItem is null)
        {
            return;
        }

        var defaults = ResolveEditableMetricsForTarget(SelectedInstanceMetricItem.Target);
        var enabled = _instanceMetricConfigDraft.TryGetValue(SelectedInstanceMetricItem.Id, out var current)
            ? current.Where(metric => !string.IsNullOrWhiteSpace(metric)).ToHashSet(StringComparer.OrdinalIgnoreCase)
            : defaults.ToHashSet(StringComparer.OrdinalIgnoreCase);

        if (!enabled.Add(item.Key))
        {
            enabled.Remove(item.Key);
        }

        if (enabled.SetEquals(defaults))
        {
            _instanceMetricConfigDraft.Remove(SelectedInstanceMetricItem.Id);
        }
        else
        {
            _instanceMetricConfigDraft[SelectedInstanceMetricItem.Id] = defaults
                .Where(enabled.Contains)
                .ToList();
        }

        UpdateCloudSyncPending(true);
        OnPropertyChanged(nameof(SelectedInstanceMetricEditorSummary));
        QueueSave();
    }

    private IEnumerable<ProbeInstanceItemViewModel> ResolveCollection(string target)
    {
        return target switch
        {
            "cpu" => CpuInstances,
            "disk" => DiskInstances,
            "network" => NetworkInstances,
            "gpu" => GpuInstances,
            _ => []
        };
    }

    private void QueueSave()
    {
        if (_isApplyingState || !_initialized)
        {
            return;
        }

        _saveVersion++;
        MarkLocalSavePending();
        _ = SaveDebouncedAsync(_saveVersion);
    }

    private void BeginBackendAction(string operationCode)
    {
        _activeOperationCode = operationCode;
        RaiseInteractionStateChanged();
    }

    private void EndBackendAction(string operationCode)
    {
        if (!string.Equals(_activeOperationCode, operationCode, StringComparison.Ordinal))
        {
            return;
        }

        _activeOperationCode = "";
        RaiseInteractionStateChanged();
    }

    private void SetStickyNotice(string message)
    {
        _noticeOverrideExpiresAt = DateTimeOffset.UtcNow.Add(NoticeOverrideHoldDuration);
        NoticeText = message;
    }

    private void SetStatusNotice(string message)
    {
        if (DateTimeOffset.UtcNow < _noticeOverrideExpiresAt)
        {
            return;
        }

        NoticeText = message;
    }

    private void MarkLocalSavePending()
    {
        _localSavePending = true;
        _localSaveStatusCode = "pending";
        LocalSaveStateText = "检测到本地配置改动，正在等待自动保存。";
        LocalSaveStateDetailText = "WinUI 会在短暂防抖后把当前配置写入本地 Go backend，避免你连续调整时频繁落盘。";
        RaiseStatusSummaryChanged();
    }

    private void MarkLocalSaveInProgress(string detail)
    {
        _localSaveStatusCode = "saving";
        LocalSaveStateText = "正在写入本地配置。";
        LocalSaveStateDetailText = detail;
        RaiseStatusSummaryChanged();
    }

    private void MarkLocalSaveSucceeded(string detail)
    {
        _localSavePending = false;
        _localSaveStatusCode = "saved";
        LocalSaveStateText = "本地配置已保存。";
        LocalSaveStateDetailText = $"{detail} 保存时间：{DateTimeOffset.Now:yyyy-MM-dd HH:mm:ss}。";
        RaiseStatusSummaryChanged();
    }

    private void MarkLocalSaveFailed(string error)
    {
        _localSaveStatusCode = "failed";
        LocalSaveStateText = "本地配置保存失败。";
        LocalSaveStateDetailText = $"失败原因：{error}。WinUI 会在你下一次继续修改或执行需要保存的操作时重新尝试。";
        RaiseStatusSummaryChanged();
    }

    private static void MergeInstanceSelection(
        IDictionary<string, List<string>> result,
        string target,
        IEnumerable<ProbeInstanceItemViewModel> items)
    {
        var materialized = items.ToList();
        if (materialized.Count == 0)
        {
            return;
        }

        if (materialized.All(item => item.IsEnabled))
        {
            result.Remove(target);
            return;
        }

        result[target] = materialized
            .Where(item => item.IsEnabled)
            .Select(item => item.Id)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static void AppendSelectedMetrics(List<string> metrics, IEnumerable<MetricToggleItemViewModel> items, bool enabled)
    {
        if (!enabled)
        {
            return;
        }

        metrics.AddRange(items
            .Where(item => item.IsEnabled)
            .Select(item => item.Key));
    }

    private bool SetAndQueueSave<T>(ref T storage, T value, bool markCloudDisplayDirty = false, [System.Runtime.CompilerServices.CallerMemberName] string? propertyName = null)
    {
        if (!SetProperty(ref storage, value, propertyName))
        {
            return false;
        }

        if (!_isApplyingState && IsConnectionConfigProperty(propertyName))
        {
            InvalidateConnectionCheckResult();
        }

        if (!_isApplyingState && IsProbeAffectingProperty(propertyName))
        {
            InvalidateDetectResult();
        }

        if (markCloudDisplayDirty && !_isApplyingState && _initialized)
        {
            UpdateCloudSyncPending(true);
        }

        if (!_isApplyingState && IsMetricSummaryProperty(propertyName))
        {
            NotifyMetricSummaryChanged(propertyName);
        }

        if (!_isApplyingState && string.Equals(propertyName, nameof(CloudSyncEnabled), StringComparison.Ordinal))
        {
            UpdateCloudSyncPresentation();
            RaiseStatusSummaryChanged();
        }

        RaiseInteractionStateChanged();
        QueueSave();
        return true;
    }

    private void UpdateCloudSyncPending(bool pending)
    {
        if (_cloudPushPending == pending)
        {
            return;
        }

        _cloudPushPending = pending;
        UpdateCloudSyncPresentation();
        RaiseStatusSummaryChanged();
    }

    private void MarkCloudSyncSucceeded()
    {
        _hasCloudSyncAttempt = true;
        _lastCloudSyncSucceeded = true;
        _lastCloudSyncAtText = DateTimeOffset.UtcNow.ToString("O");
        _lastCloudSyncErrorText = "";
        UpdateCloudSyncPresentation();
        RaiseStatusSummaryChanged();
    }

    private void MarkCloudSyncFailed(string error)
    {
        _hasCloudSyncAttempt = true;
        _lastCloudSyncSucceeded = false;
        _lastCloudSyncAtText = DateTimeOffset.UtcNow.ToString("O");
        _lastCloudSyncErrorText = error;
        UpdateCloudSyncPresentation();
        RaiseStatusSummaryChanged();
    }

    private void UpdateCloudSyncPresentation()
    {
        CloudSyncText = BuildCloudSyncText();
    }

    private string BuildCloudSyncText()
    {
        if (!CloudSyncEnabled)
        {
            return "展示同步当前已关闭。本地配置仍会自动保存并立即影响 agent 采集与发送，但当前不会把展示配置推送到中枢。";
        }

        var lastSyncText = string.IsNullOrWhiteSpace(_lastCloudSyncAtText)
            ? "云端展示配置尚未推送。"
            : string.IsNullOrWhiteSpace(_lastCloudSyncErrorText)
                ? $"最近一次云端推送成功：{FormatRealtimeExpiry(_lastCloudSyncAtText)}"
                : $"最近一次云端推送失败：{FormatRealtimeExpiry(_lastCloudSyncAtText)}，{_lastCloudSyncErrorText}";

        if (_cloudPushPending)
        {
            return !_hasCloudSyncAttempt
                ? $"{lastSyncText} 当前这台设备的展示配置还没有推送到中枢；点击按钮后，网页和客户端才会按当前类别显示。"
                : $"{lastSyncText} 当前有本地展示配置变更尚未推送到中枢；点击按钮后，网页和客户端会更新为最新展示类别。";
        }

        return string.IsNullOrWhiteSpace(_lastCloudSyncErrorText)
            ? $"{lastSyncText} 当前网页和客户端已经按最近一次推送的展示配置显示。"
            : $"{lastSyncText} 你可以在修正问题后再次推送展示配置。";
    }

    private void RaiseInteractionStateChanged()
    {
        OnPropertyChanged(nameof(HasConnectionConfig));
        OnPropertyChanged(nameof(ConnectionSetupHint));
        OnPropertyChanged(nameof(NoticeHeadline));
        OnPropertyChanged(nameof(CanStartCollector));
        OnPropertyChanged(nameof(CanStopCollector));
        OnPropertyChanged(nameof(CanRunDetect));
        OnPropertyChanged(nameof(CanCheckConnection));
        OnPropertyChanged(nameof(CanPushCloud));
        OnPropertyChanged(nameof(CanToggleRealtime));
        OnPropertyChanged(nameof(CanLoginViewer));
        OnPropertyChanged(nameof(StartButtonText));
        OnPropertyChanged(nameof(StopButtonText));
        OnPropertyChanged(nameof(CheckConnectionButtonText));
        OnPropertyChanged(nameof(RealtimeButtonText));
        OnPropertyChanged(nameof(DetectButtonText));
        OnPropertyChanged(nameof(PushCloudButtonText));
        OnPropertyChanged(nameof(CloudSyncActionHint));
        OnPropertyChanged(nameof(CurrentOperationBadgeText));
        OnPropertyChanged(nameof(CurrentOperationText));
        OnPropertyChanged(nameof(CurrentOperationDetailText));
        OnPropertyChanged(nameof(IsInstanceEditingEnabled));
        OnPropertyChanged(nameof(InstanceEditingHintText));
        StartBackendCommand.RaiseCanExecuteChanged();
        StopBackendCommand.RaiseCanExecuteChanged();
        DetectCommand.RaiseCanExecuteChanged();
        CheckConnectionCommand.RaiseCanExecuteChanged();
        PushCloudCommand.RaiseCanExecuteChanged();
        ToggleRealtimeModeCommand.RaiseCanExecuteChanged();
        LoginViewerCommand.RaiseCanExecuteChanged();
    }

    private void RaiseStatusSummaryChanged()
    {
        OnPropertyChanged(nameof(LocalBackendBadgeText));
        OnPropertyChanged(nameof(CollectorBadgeText));
        OnPropertyChanged(nameof(ConnectionBadgeText));
        OnPropertyChanged(nameof(ControlStreamBadgeText));
        OnPropertyChanged(nameof(ControlStreamSpotlightKicker));
        OnPropertyChanged(nameof(ControlStreamSpotlightHeadline));
        OnPropertyChanged(nameof(RunModeBadgeText));
        OnPropertyChanged(nameof(BackendRecoveryBadgeText));
        OnPropertyChanged(nameof(LocalSaveBadgeText));
        OnPropertyChanged(nameof(DetectFreshnessBadgeText));
        OnPropertyChanged(nameof(DetectFreshnessText));
        OnPropertyChanged(nameof(DetectFreshnessDetailText));
        OnPropertyChanged(nameof(IsInstanceEditingEnabled));
        OnPropertyChanged(nameof(InstanceEditingHintText));
        OnPropertyChanged(nameof(ShowConnectionCheckWarning));
        OnPropertyChanged(nameof(ShowConnectionCheckSuccess));
        OnPropertyChanged(nameof(ShowConnectionConnected));
        OnPropertyChanged(nameof(ShowConnectionBusy));
        OnPropertyChanged(nameof(ShowConnectionProblem));
        OnPropertyChanged(nameof(ConnectionConnectedVisibility));
        OnPropertyChanged(nameof(ConnectionBusyVisibility));
        OnPropertyChanged(nameof(ConnectionProblemVisibility));
        OnPropertyChanged(nameof(ConnectionCheckAlertTitle));
        OnPropertyChanged(nameof(ShowBackendRecoveryWarning));
        OnPropertyChanged(nameof(ShowBackendRecoveryRecovered));
        OnPropertyChanged(nameof(ShowBackendRecoveryStable));
        OnPropertyChanged(nameof(BackendRecoveryWarningVisibility));
        OnPropertyChanged(nameof(BackendRecoveryRecoveredVisibility));
        OnPropertyChanged(nameof(BackendRecoveryStableVisibility));
        OnPropertyChanged(nameof(BackendRecoveryAlertTitle));
        OnPropertyChanged(nameof(ShowControlStreamWarning));
        OnPropertyChanged(nameof(ShowControlStreamKeepalive));
        OnPropertyChanged(nameof(ShowControlStreamSuccess));
        OnPropertyChanged(nameof(ShowControlStreamInfo));
        OnPropertyChanged(nameof(ControlStreamWarningVisibility));
        OnPropertyChanged(nameof(ControlStreamKeepaliveVisibility));
        OnPropertyChanged(nameof(ControlStreamSuccessVisibility));
        OnPropertyChanged(nameof(ControlStreamInfoVisibility));
        OnPropertyChanged(nameof(ControlStreamAlertTitle));
        OnPropertyChanged(nameof(ControlStreamAlertDetail));
        OnPropertyChanged(nameof(CloudSyncBadgeText));
        OnPropertyChanged(nameof(ConnectionSetupHint));
        OnPropertyChanged(nameof(NoticeHeadline));
        OnPropertyChanged(nameof(FirstRunGuideTitle));
        OnPropertyChanged(nameof(FirstRunGuideText));
        OnPropertyChanged(nameof(ModeGuideTitle));
        OnPropertyChanged(nameof(ModeGuideText));
        OnPropertyChanged(nameof(ModeGuideDetailText));
        OnPropertyChanged(nameof(ModeStartupTitle));
        OnPropertyChanged(nameof(ModeStartupText));
        OnPropertyChanged(nameof(ModeStartupDetailText));
        OnPropertyChanged(nameof(LocalArtifactBadgeText));
        OnPropertyChanged(nameof(LocalArtifactSummaryText));
        OnPropertyChanged(nameof(LocalArtifactDetailText));
        OnPropertyChanged(nameof(TrayMonitorStatusText));
        OnPropertyChanged(nameof(TrayMonitorDetailText));
        OnPropertyChanged(nameof(TraySubmitStatusText));
        OnPropertyChanged(nameof(TraySubmitDetailText));
        OnPropertyChanged(nameof(TrayLifecycleStatusText));
        OnPropertyChanged(nameof(TrayLifecycleDetailText));
        OnPropertyChanged(nameof(CanStartCollector));
        OnPropertyChanged(nameof(CanStopCollector));
        OnPropertyChanged(nameof(CanRunDetect));
        OnPropertyChanged(nameof(CanCheckConnection));
        OnPropertyChanged(nameof(CanPushCloud));
        OnPropertyChanged(nameof(CanToggleRealtime));
        OnPropertyChanged(nameof(StartButtonText));
        OnPropertyChanged(nameof(StopButtonText));
        OnPropertyChanged(nameof(CheckConnectionButtonText));
        OnPropertyChanged(nameof(RealtimeButtonText));
        OnPropertyChanged(nameof(DetectButtonText));
        OnPropertyChanged(nameof(PushCloudButtonText));
        OnPropertyChanged(nameof(CloudSyncActionHint));
        OnPropertyChanged(nameof(CurrentOperationBadgeText));
        OnPropertyChanged(nameof(CurrentOperationText));
        OnPropertyChanged(nameof(CurrentOperationDetailText));
        StartBackendCommand.RaiseCanExecuteChanged();
        StopBackendCommand.RaiseCanExecuteChanged();
        DetectCommand.RaiseCanExecuteChanged();
        CheckConnectionCommand.RaiseCanExecuteChanged();
        PushCloudCommand.RaiseCanExecuteChanged();
        ToggleRealtimeModeCommand.RaiseCanExecuteChanged();
    }

    private string BuildLocalBackendStateText(BackendStateDto state)
    {
        var startedAtText = string.IsNullOrWhiteSpace(state.BackendStartedAt)
            ? "启动时间待确认。"
            : $"Go backend 自 {state.BackendStartedAt} 启动。";
        var ownerText = _isUsingSharedBackend
            ? "当前 WinUI 正在复用一份已存在的本地 backend；关闭这个窗口时不会主动停止那份共享 backend。"
            : "当前 WinUI 正在直接管理这份本地 backend。";

        if (!state.Running)
        {
            return $"本地控制后端在线。{startedAtText} {ownerText}";
        }

        return $"本地控制后端在线，并正在托管采集器进程。{startedAtText} {ownerText}";
    }

    private static string BuildCollectorStateText(BackendStateDto state)
    {
        if (!state.Running)
        {
            var exitText = string.IsNullOrWhiteSpace(state.LastExitAt)
                ? "当前还没有记录到最近一次退出。"
                : state.LastExitCode.HasValue
                    ? $"最近一次退出：{state.LastExitAt}，退出码 {state.LastExitCode.Value}。"
                    : $"最近一次退出：{state.LastExitAt}。";
            var restartText = state.Config.AutoRestartCollector
                ? state.AutoRestartPending
                    ? $"自动重启已开启，正在等待下一次拉起；累计自动重启 {state.RestartCount} 次。"
                    : $"自动重启已开启；累计自动重启 {state.RestartCount} 次。"
                : "自动重启已关闭。";
            var modeText = state.RealtimeModeEnabled
                ? string.IsNullOrWhiteSpace(state.RealtimeModeExpiresAt)
                    ? $"当前计划以下一轮使用实时上传间隔 {state.EffectiveUploadIntervalSeconds} 秒。"
                    : $"当前计划以下一轮使用实时上传间隔 {state.EffectiveUploadIntervalSeconds} 秒，并将在 {FormatRealtimeExpiry(state.RealtimeModeExpiresAt)} 自动回落。"
                : $"当前计划以下一轮使用常态上传间隔 {state.EffectiveUploadIntervalSeconds} 秒。";
            return $"采集器未运行。{exitText} {restartText} {modeText}";
        }

        if (string.IsNullOrWhiteSpace(state.ChildStartedAt))
        {
            return "采集器正在启动，等待子进程进入稳定运行状态。";
        }

        return state.RestartCount > 0 && !string.IsNullOrWhiteSpace(state.LastRestartAt)
            ? $"采集器已启动：{state.ChildStartedAt}，连接状态 {state.ConnectionStatus}，当前生效上传间隔 {state.EffectiveUploadIntervalSeconds} 秒。{BuildRealtimeSuffix(state)}最近一次自动重启：{state.LastRestartAt}，累计 {state.RestartCount} 次。"
            : $"采集器已启动：{state.ChildStartedAt}，连接状态 {state.ConnectionStatus}，当前生效上传间隔 {state.EffectiveUploadIntervalSeconds} 秒。{BuildRealtimeSuffix(state)}";
    }

    private static string BuildConnectionText(BackendStateDto state)
    {
        var baseText = $"连接状态：{state.ConnectionStatus}";
        if (state.ControlStreamConnected)
        {
            return $"{baseText}；中枢实时控制通道已连通。";
        }

        if (!string.IsNullOrWhiteSpace(state.LastControlStreamDisconnectAt))
        {
            return $"{baseText}；中枢实时控制通道最近一次断开于 {FormatRealtimeExpiry(state.LastControlStreamDisconnectAt)}，当前已回退到低频轮询。";
        }

        return $"{baseText}；中枢实时控制通道当前未连通，正在使用回退轮询。";
    }

    private static string BuildArtifactPathText(string label, string? path, bool exists)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            return $"{label}：当前不可用。";
        }

        return exists
            ? $"{label}：{path}（已生成）"
            : $"{label}：{path}（尚未生成）";
    }

    private string BuildLocalArtifactSummaryText()
    {
        if (!_backendReachable)
        {
            return "正在等待本地 backend 恢复，暂时无法确认本地配置文件、同步状态文件和诊断日志是否已经落盘。";
        }

        if (!_configFileExists)
        {
            return "本地配置文件尚未确认生成，通常只会出现在 backend 刚刚启动、还没完成首次写入的极早阶段。";
        }

        if (_cloudPushPending && _syncStateFileExists)
        {
            return "待推送展示配置已经写入本地同步状态文件；即使 WinUI 或 backend 重启，这个待推送状态也能恢复。";
        }

        if (!_syncStateFileExists)
        {
            return "当前还没有生成同步状态文件，这通常表示还没有需要持久化的展示配置待推送状态。";
        }

        if (_hasCloudSyncAttempt && !_cloudPushPending)
        {
            return "本地配置文件和同步状态文件都已就绪，当前没有待推送的展示配置。";
        }

        return "本地配置和诊断日志已经就绪，可以继续调整采样频次、探测方案和实例记录范围。";
    }

    private string BuildLocalArtifactDetailText()
    {
        var diagnosticsText = _diagnosticsFileExists
            ? "诊断日志文件已经生成，若后端或采集器异常掉线，可以直接按当前路径查看。"
            : "诊断日志文件尚未生成，通常会在 backend 首次写入诊断信息后出现。";

        return _isPortableMode
            ? $"当前是便携模式，这些文件会跟随程序目录一起移动。{diagnosticsText}"
            : $"当前是安装模式，程序二进制保留在安装目录，本地状态文件落在 LocalAppData。{diagnosticsText}";
    }

    private static string ResolveLocalArtifactBadgeText(bool backendReachable, bool configExists, bool syncExists, bool diagnosticsExists, bool cloudPushPending)
    {
        if (!backendReachable)
        {
            return "落盘状态待确认";
        }

        if (configExists && diagnosticsExists && cloudPushPending && syncExists)
        {
            return "待推送已落盘";
        }

        if (configExists && diagnosticsExists)
        {
            return syncExists ? "本地落盘已就绪" : "本地配置已生成";
        }

        if (configExists)
        {
            return "配置已生成";
        }

        return "等待首写入";
    }

    private static string BuildRealtimeStatusText(BackendStateDto state)
    {
        if (!state.RealtimeModeEnabled)
        {
            return $"当前处于常态上传模式，生效间隔 {state.EffectiveUploadIntervalSeconds} 秒。";
        }

        if (string.IsNullOrWhiteSpace(state.RealtimeModeExpiresAt))
        {
            return $"当前处于{ResolveRealtimeSourceLabel(state.RealtimeModeSource)}实时上传模式，生效间隔 {state.EffectiveUploadIntervalSeconds} 秒。";
        }

        if (string.Equals(state.RealtimeModeSource, "viewer", StringComparison.OrdinalIgnoreCase))
        {
            if (string.Equals(state.ViewerRealtimePhase, "active", StringComparison.OrdinalIgnoreCase))
            {
                return $"当前有人正在通过云端查看该设备，实时上传已生效，当前 viewer 数 {state.LastViewerRealtimeViewerCount}，上传间隔 {state.EffectiveUploadIntervalSeconds} 秒；Viewer 实时保持窗口为 {Math.Max(5, state.Config.Sampling.ViewerRealtimeHoldSeconds)} 秒，将在 {FormatRealtimeExpiry(state.RealtimeModeExpiresAt)} 自动回落。";
            }

            return $"云端 viewer 刚刚离开，agent 仍处于实时上传保持窗口内，当前上传间隔 {state.EffectiveUploadIntervalSeconds} 秒；Viewer 实时保持窗口为 {Math.Max(5, state.Config.Sampling.ViewerRealtimeHoldSeconds)} 秒，将在 {FormatRealtimeExpiry(state.RealtimeModeExpiresAt)} 自动回落。";
        }

        return $"当前处于{ResolveRealtimeSourceLabel(state.RealtimeModeSource)}实时上传模式，生效间隔 {state.EffectiveUploadIntervalSeconds} 秒，将在 {FormatRealtimeExpiry(state.RealtimeModeExpiresAt)} 自动回落。";
    }

    private static string BuildRealtimeSuffix(BackendStateDto state)
    {
        if (!state.RealtimeModeEnabled || string.IsNullOrWhiteSpace(state.RealtimeModeExpiresAt))
        {
            return "";
        }

        return $"实时模式将于 {FormatRealtimeExpiry(state.RealtimeModeExpiresAt)} 自动回落。";
    }

    private static string BuildRealtimeControlText(BackendStateDto state)
    {
        if (state.ControlStreamConnected)
        {
            if (string.Equals(state.LastControlStreamSnapshotKind, "keepalive", StringComparison.OrdinalIgnoreCase) &&
                !string.IsNullOrWhiteSpace(state.LastControlStreamSnapshotAt))
            {
                if (string.Equals(state.ViewerRealtimePhase, "active", StringComparison.OrdinalIgnoreCase))
                {
                    return $"中枢实时控制通道已连通，最近一次收到的是保活快照：{FormatRealtimeExpiry(state.LastControlStreamSnapshotAt)}。当前 viewer 数 {state.LastViewerRealtimeViewerCount}，agent 会持续保持实时上传。";
                }

                return $"中枢实时控制通道已连通，最近一次收到的是保活快照：{FormatRealtimeExpiry(state.LastControlStreamSnapshotAt)}。Viewer 已离开，但 agent 仍会按 {Math.Max(5, state.Config.Sampling.ViewerRealtimeHoldSeconds)} 秒保持窗口延迟回落。";
            }

            return string.IsNullOrWhiteSpace(state.LastControlStreamEventAt)
                ? $"中枢实时控制通道已连通，当前会优先接收服务端主动推送的查看状态；Viewer 实时保持窗口为 {Math.Max(5, state.Config.Sampling.ViewerRealtimeHoldSeconds)} 秒。"
                : $"中枢实时控制通道已连通，最近一次状态推送：{FormatRealtimeExpiry(state.LastControlStreamEventAt)}。Viewer 实时保持窗口为 {Math.Max(5, state.Config.Sampling.ViewerRealtimeHoldSeconds)} 秒。";
        }

        var disconnectText = string.IsNullOrWhiteSpace(state.LastControlStreamDisconnectAt)
            ? ""
            : $" 最近一次断开：{FormatRealtimeExpiry(state.LastControlStreamDisconnectAt)}。";
        var resolvedError = ResolveControlStreamErrorLabel(state.LastControlStreamError);
        var errorText = string.IsNullOrWhiteSpace(resolvedError)
            ? ""
            : $" 断开原因：{resolvedError}。";

        return string.IsNullOrWhiteSpace(state.LastControlStreamEventAt)
            ? $"中枢实时控制通道尚未连通，当前会回退到低频轮询以判断是否有人正在查看该设备；若刚刚丢失 Viewer，agent 仍会按 {Math.Max(5, state.Config.Sampling.ViewerRealtimeHoldSeconds)} 秒保持窗口延迟回落。{disconnectText}{errorText}".Trim()
            : $"中枢实时控制通道当前未连通，最近一次收到推送：{FormatRealtimeExpiry(state.LastControlStreamEventAt)}；当前已回退到低频轮询。若刚刚丢失 Viewer，agent 仍会按 {Math.Max(5, state.Config.Sampling.ViewerRealtimeHoldSeconds)} 秒保持窗口延迟回落。{disconnectText}{errorText}".Trim();
    }

    private static string ResolveControlStreamStatusCode(BackendStateDto state)
    {
        if (state.ControlStreamConnected)
        {
            if (string.Equals(state.LastControlStreamSnapshotKind, "keepalive", StringComparison.OrdinalIgnoreCase))
            {
                return "connected-keepalive";
            }

            return "connected";
        }

        if (IsControlStreamRecovering(state.LastControlStreamError))
        {
            return "recovering";
        }

        if (!string.IsNullOrWhiteSpace(state.LastControlStreamDisconnectAt) || !string.IsNullOrWhiteSpace(state.LastControlStreamError))
        {
            return "fallback";
        }

        return "idle";
    }

    private static string ResolveControlStreamBadgeText(string statusCode)
    {
        return statusCode switch
        {
            "connected" => "控制流已连通",
            "connected-keepalive" => "控制流保活中",
            "recovering" => "控制流重连中",
            "fallback" => "控制流已回退",
            "waiting" => "控制流待恢复",
            "idle" => "控制流待建立",
            _ => "控制流待确认"
        };
    }

    private static string BuildControlStreamStateText(BackendStateDto state)
    {
        if (state.ControlStreamConnected)
        {
            if (string.Equals(state.LastControlStreamSnapshotKind, "keepalive", StringComparison.OrdinalIgnoreCase))
            {
                return "实时控制链路已连通，最近收到的是周期性保活快照，说明主动推送链路仍然活跃。";
            }

            return "实时控制链路已连通，当前会优先使用服务端主动推送来切换查看驱动的实时模式。";
        }

        if (!string.IsNullOrWhiteSpace(state.LastControlStreamDisconnectAt) || !string.IsNullOrWhiteSpace(state.LastControlStreamError))
        {
            if (IsControlStreamRecovering(state.LastControlStreamError))
            {
                return "实时控制链路长时间没有收到新的 viewer 快照，backend 已主动终止旧连接并开始重连；当前仍使用低频轮询兜底。";
            }

            return "实时控制链路当前未连通，backend 已回退到低频轮询模式，仍可继续判断是否有人正在查看该设备。";
        }

        return "实时控制链路尚未建立，backend 会继续尝试连接服务端主动推送通道。";
    }

    private static string BuildControlStreamLastEventText(BackendStateDto state)
    {
        if (string.Equals(state.LastControlStreamSnapshotKind, "keepalive", StringComparison.OrdinalIgnoreCase) &&
            !string.IsNullOrWhiteSpace(state.LastControlStreamSnapshotAt))
        {
            return $"最近保活快照：{FormatRealtimeExpiry(state.LastControlStreamSnapshotAt)}。";
        }

        return string.IsNullOrWhiteSpace(state.LastControlStreamEventAt)
            ? "最近状态推送：暂无。"
            : $"最近状态推送：{FormatRealtimeExpiry(state.LastControlStreamEventAt)}。";
    }

    private static string BuildControlStreamLastDisconnectText(BackendStateDto state)
    {
        return string.IsNullOrWhiteSpace(state.LastControlStreamDisconnectAt)
            ? "最近断开：暂无。"
            : $"最近断开：{FormatRealtimeExpiry(state.LastControlStreamDisconnectAt)}。";
    }

    private static string BuildControlStreamReconnectText(BackendStateDto state)
    {
        if (state.ControlStreamReconnectCount <= 0)
        {
            return "主动重连：暂无。";
        }

        if (string.IsNullOrWhiteSpace(state.LastControlStreamReconnectAt))
        {
            return $"主动重连：累计 {state.ControlStreamReconnectCount} 次。";
        }

        return $"主动重连：累计 {state.ControlStreamReconnectCount} 次，最近一次 {FormatRealtimeExpiry(state.LastControlStreamReconnectAt)}。";
    }

    private static string BuildControlStreamHealthText(BackendStateDto state)
    {
        if (state.ControlStreamConnected && state.ControlStreamReconnectCount <= 0)
        {
            return "链路健康度：主动推送链路稳定，当前未发现重连。";
        }

        if (HasFrequentControlStreamReconnects(state))
        {
            return "链路健康度：主动推送链路近期已多次主动重连，当前稳定性偏弱，建议优先检查 Windows 网络空闲超时、代理保活和休眠恢复后的连接状态。";
        }

        if (state.ControlStreamReconnectCount > 0)
        {
            return "链路健康度：曾发生主动重连，但目前仍具备自愈能力；若持续增加，建议进一步检查本机网络链路。";
        }

        return "链路健康度：当前未发现频繁重连。";
    }

    private static string BuildControlStreamCategoryText(BackendStateDto state)
    {
        var classification = ClassifyControlStreamIssue(state.LastControlStreamError);
        return classification.Category switch
        {
            "healthy" when string.Equals(state.LastControlStreamSnapshotKind, "keepalive", StringComparison.OrdinalIgnoreCase) => "问题类别：当前无异常，主动推送链路处于保活稳定状态。",
            "healthy" => "问题类别：当前无异常，主动推送链路可用。",
            "none" => "问题类别：暂无异常，正在等待首次建立主动推送链路。",
            "stale" when HasFrequentControlStreamReconnects(state) => "问题类别：主动推送链路频繁静默超时，backend 正在反复重连。",
            "stale" => "问题类别：主动推送链路静默超时，backend 正在主动重连。",
            "config" => "问题类别：本地配置问题。",
            "capability" => "问题类别：中枢能力或接口问题。",
            "network" => "问题类别：网络或链路连接问题。",
            "server" => "问题类别：服务端主动断开或服务端状态异常。",
            _ => "问题类别：控制流状态待确认。"
        };
    }

    private static string BuildControlStreamErrorText(BackendStateDto state)
    {
        var resolvedError = ResolveControlStreamErrorLabel(state.LastControlStreamError);
        return string.IsNullOrWhiteSpace(resolvedError)
            ? "断开原因：暂无。"
            : $"断开原因：{resolvedError}。";
    }

    private static string BuildControlStreamActionText(BackendStateDto state)
    {
        var classification = ClassifyControlStreamIssue(state.LastControlStreamError);
        return classification.Suggestion switch
        {
            "" when state.ControlStreamConnected && string.Equals(state.LastControlStreamSnapshotKind, "keepalive", StringComparison.OrdinalIgnoreCase) => "建议操作：无需处理，当前主动推送链路已连通，并且保活快照在持续到达。",
            "" when state.ControlStreamConnected => "建议操作：无需处理，当前已通过服务端主动推送接收实时控制。",
            var suggestion when classification.Category == "stale" && HasFrequentControlStreamReconnects(state) => $"建议操作：{suggestion} 如果短时间内继续增长，优先检查 Windows 端网络空闲超时、代理保活和系统休眠策略。",
            "" => "建议操作：保持当前状态即可；backend 会继续尝试建立或维护主动推送链路。",
            var suggestion => $"建议操作：{suggestion}"
        };
    }

    private static string BuildControlStreamTransportText(BackendStateDto state)
    {
        if (!state.ControlStreamConnected && IsControlStreamRecovering(state.LastControlStreamError))
        {
            return "控制方式：当前已主动终止静默连接并重新建链，过渡期间由低频轮询兜底。";
        }

        return state.ControlStreamConnected
            ? string.Equals(state.LastControlStreamSnapshotKind, "keepalive", StringComparison.OrdinalIgnoreCase)
                ? "控制方式：当前通过服务端主动推送维持控制链路保活，并持续接收 viewer 快照。"
                : "控制方式：当前通过服务端主动推送接收 viewer-driven realtime 控制。"
            : "控制方式：当前通过低频轮询兜底，后台仍会持续重试主动推送链路。";
    }

    private static string ResolveRealtimeSourceLabel(string? value)
    {
        return string.Equals(value, "viewer", StringComparison.OrdinalIgnoreCase) ? "云端观看驱动的" : "";
    }

    private static string ResolveConnectionBadgeText(string? value)
    {
        return value?.Trim().ToLowerInvariant() switch
        {
            "connected" => "已连接中枢",
            "starting" => "正在启动",
            "stopping" => "正在停止",
            "restart-wait" => "等待重启",
            "error" => "连接异常",
            "offline" => "本地未响应",
            _ => "尚未连接"
        };
    }

    private static string ResolveBackendRecoveryBadgeText(string? value)
    {
        return value?.Trim().ToLowerInvariant() switch
        {
            "recovering" => "后端恢复中",
            "waiting" => "等待恢复",
            "recovered" => "后端已恢复",
            _ => "后端稳定"
        };
    }

    private static string ResolveLocalSaveBadgeText(string? value)
    {
        return value?.Trim().ToLowerInvariant() switch
        {
            "pending" => "本地保存排队中",
            "saving" => "本地保存中",
            "saved" => "本地已保存",
            "failed" => "本地保存失败",
            _ => "本地保存待命"
        };
    }

    private void InvalidateConnectionCheckResult()
    {
        _connectionCheckStatusCode = "idle";
        ConnectionCheckText = "连接信息刚发生变化，建议重新检查中枢连接。";
        ConnectionCheckDetailText = "你已经修改了 Server URL、Agent Secret 或 Device ID。之前的连接检查结果可能已经过期，请重新执行一次“检查中枢连接”。";
        RaiseStatusSummaryChanged();
    }

    private static bool IsConnectionConfigProperty(string? propertyName)
    {
        return string.Equals(propertyName, nameof(ServerUrl), StringComparison.Ordinal) ||
               string.Equals(propertyName, nameof(Secret), StringComparison.Ordinal) ||
               string.Equals(propertyName, nameof(DeviceId), StringComparison.Ordinal);
    }

    private void InvalidateDetectResult()
    {
        _detectNeedsRefresh = true;
        _detectFreshnessStatusCode = "stale";
        DetectFreshnessText = "探测结果已过期。";
        DetectFreshnessDetailText = "探测方案或记录类别刚发生变化，当前实例清单可能不再代表最新可用目标。建议重新执行一次组件探测。";
        DetectStatusText = "探测相关配置刚发生变化，建议重新执行组件探测以刷新实例清单。";
        NoticeText = "探测方案或记录类别已更新；若你需要最新的 CPU、磁盘、网卡或显卡实例列表，请重新执行组件探测。";
        RaiseStatusSummaryChanged();
    }

    private void MarkDetectFresh()
    {
        _detectNeedsRefresh = false;
        _detectFreshnessStatusCode = "fresh";
        DetectFreshnessText = "探测结果已刷新。";
        DetectFreshnessDetailText = "当前实例清单已按最新探测结果更新，你可以继续按实例关闭某个 CPU 包、磁盘、网卡或显卡记录。";
        RaiseStatusSummaryChanged();
    }

    private void MarkDetectFreshEmpty()
    {
        _detectNeedsRefresh = false;
        _detectFreshnessStatusCode = "empty";
        DetectFreshnessText = "探测已完成，但当前没有返回实例清单。";
        DetectFreshnessDetailText = "这通常表示当前探测接口没有发现可单独配置的实例，或本机暂时不支持对应类别的细粒度实例列表。";
        RaiseStatusSummaryChanged();
    }

    private void SyncDetectFreshnessFromState(BackendStateDto state)
    {
        var detectedCount = CountDetectedInstances(state.DetectedTargets);
        var fingerprint = BuildDetectFreshnessFingerprint(state.LastDetectAt, detectedCount);
        if (_detectNeedsRefresh && string.Equals(_detectFreshnessFingerprint, fingerprint, StringComparison.Ordinal))
        {
            return;
        }

        _detectFreshnessFingerprint = fingerprint;
        _detectNeedsRefresh = false;

        if (string.IsNullOrWhiteSpace(state.LastDetectAt))
        {
            _detectFreshnessStatusCode = "idle";
            DetectFreshnessText = "当前还没有可用的探测结果。";
            DetectFreshnessDetailText = "首次使用时，建议先执行一次组件探测，再根据返回的实例清单决定保留哪些 CPU、磁盘、网卡和显卡记录。";
            return;
        }

        if (detectedCount > 0)
        {
            _detectFreshnessStatusCode = "fresh";
            DetectFreshnessText = "探测结果仍然有效。";
            DetectFreshnessDetailText = $"最近一次探测已经返回 {detectedCount} 个可配置实例；若你继续修改探测方案或类别开关，系统会提示你重新探测。";
            return;
        }

        _detectFreshnessStatusCode = "empty";
        DetectFreshnessText = "最近一次探测未返回实例清单。";
        DetectFreshnessDetailText = "如果你已经确认当前探测方案无误，可以继续直接保存类别开关；若怀疑探测条件有变化，也可以再次执行组件探测。";
    }

    private static string BuildDetectFreshnessFingerprint(string? lastDetectAt, int detectedCount)
    {
        return $"{lastDetectAt?.Trim() ?? ""}|{detectedCount}";
    }

    private static bool IsProbeAffectingProperty(string? propertyName)
    {
        return string.Equals(propertyName, nameof(CpuEnabled), StringComparison.Ordinal) ||
               string.Equals(propertyName, nameof(MemoryEnabled), StringComparison.Ordinal) ||
               string.Equals(propertyName, nameof(DiskEnabled), StringComparison.Ordinal) ||
               string.Equals(propertyName, nameof(NetworkEnabled), StringComparison.Ordinal) ||
               string.Equals(propertyName, nameof(GpuEnabled), StringComparison.Ordinal) ||
               string.Equals(propertyName, nameof(FanEnabled), StringComparison.Ordinal) ||
               string.Equals(propertyName, nameof(CpuProvider), StringComparison.Ordinal) ||
               string.Equals(propertyName, nameof(MemoryProvider), StringComparison.Ordinal) ||
               string.Equals(propertyName, nameof(DiskProvider), StringComparison.Ordinal) ||
               string.Equals(propertyName, nameof(NetworkProvider), StringComparison.Ordinal) ||
               string.Equals(propertyName, nameof(GpuProvider), StringComparison.Ordinal) ||
               string.Equals(propertyName, nameof(FanProvider), StringComparison.Ordinal);
    }

    private static bool IsMetricSummaryProperty(string? propertyName)
    {
        return string.Equals(propertyName, nameof(CpuEnabled), StringComparison.Ordinal) ||
               string.Equals(propertyName, nameof(MemoryEnabled), StringComparison.Ordinal) ||
               string.Equals(propertyName, nameof(DiskEnabled), StringComparison.Ordinal) ||
               string.Equals(propertyName, nameof(NetworkEnabled), StringComparison.Ordinal) ||
               string.Equals(propertyName, nameof(GpuEnabled), StringComparison.Ordinal);
    }

    private static string ResolveDetectFreshnessBadgeText(string? value)
    {
        return value?.Trim().ToLowerInvariant() switch
        {
            "fresh" => "探测结果最新",
            "stale" => "探测结果待刷新",
            "empty" => "探测无实例",
            _ => "尚未探测"
        };
    }

    private static string BuildInstanceEditingHintText(string? value, bool isBackendActionBusy)
    {
        if (isBackendActionBusy)
        {
            return "当前正在执行本地操作。为避免基于中间态继续修改旧实例清单，实例级编辑会在操作完成后自动恢复。";
        }

        return value?.Trim().ToLowerInvariant() switch
        {
            "fresh" => "当前实例清单来自最近一次有效探测，你可以直接按实例关闭某个 CPU 包、磁盘、网卡或显卡记录，也可以继续细化这个实例允许发送的指标。",
            "stale" => "实例清单已基于旧探测结果，当前先暂停实例级编辑。请重新执行组件探测后再继续按实例调整。",
            "empty" => "最近一次探测没有返回可配置实例，因此当前没有可编辑的实例级开关。",
            _ => "请先执行一次组件探测，拿到最新实例清单后再进行实例级记录调整。"
        };
    }

    private ObservableCollection<MetricToggleItemViewModel> BuildMetricItems(string blockKey)
    {
        var collection = new ObservableCollection<MetricToggleItemViewModel>();
        foreach (var key in ResolveEditableMetricsForTarget(blockKey))
        {
            collection.Add(new MetricToggleItemViewModel(blockKey, key, ResolveMetricLabel(key), true, HandleMetricToggle));
        }

        return collection;
    }

    private static IReadOnlyList<string> ResolveEditableMetricsForTarget(string target)
    {
        return BlockMetrics.TryGetValue(target, out var keys) ? keys : [];
    }

    private static bool SupportsInstanceMetricEditing(string target)
    {
        return ResolveEditableMetricsForTarget(target).Count > 0;
    }

    private void SyncSelectedInstanceMetricEditor()
    {
        if (SelectedInstanceMetricItem is null)
        {
            return;
        }

        var selected = ResolveCollection(SelectedInstanceMetricItem.Target)
            .FirstOrDefault(item => string.Equals(item.Id, SelectedInstanceMetricItem.Id, StringComparison.OrdinalIgnoreCase));
        if (selected is null || !selected.SupportsMetricEditing)
        {
            ClearInstanceMetricEditor();
            return;
        }

        SelectedInstanceMetricItem = selected;
        RebuildSelectedInstanceMetricEditor();
    }

    private void RebuildSelectedInstanceMetricEditor()
    {
        SelectedInstanceMetricToggles.Clear();
        if (SelectedInstanceMetricItem is null)
        {
            OnPropertyChanged(nameof(HasSelectedInstanceMetricEditor));
            OnPropertyChanged(nameof(SelectedInstanceMetricEditorVisibility));
            OnPropertyChanged(nameof(SelectedInstanceMetricEditorSummary));
            return;
        }

        foreach (var key in ResolveEditableMetricsForTarget(SelectedInstanceMetricItem.Target))
        {
            SelectedInstanceMetricToggles.Add(new MetricToggleItemViewModel(
                SelectedInstanceMetricItem.Target,
                key,
                ResolveMetricLabel(key),
                IsMetricEnabledForInstance(SelectedInstanceMetricItem.Id, SelectedInstanceMetricItem.Target, key),
                HandleInstanceMetricToggle));
        }

        OnPropertyChanged(nameof(HasSelectedInstanceMetricEditor));
        OnPropertyChanged(nameof(SelectedInstanceMetricEditorVisibility));
        OnPropertyChanged(nameof(SelectedInstanceMetricEditorSummary));
    }

    private bool IsMetricEnabledForInstance(string instanceId, string target, string metricKey)
    {
        if (_instanceMetricConfigDraft.TryGetValue(instanceId, out var configured))
        {
            return configured.Contains(metricKey, StringComparer.OrdinalIgnoreCase);
        }

        return ResolveEditableMetricsForTarget(target).Contains(metricKey, StringComparer.OrdinalIgnoreCase);
    }

    private static void SyncMetricItems(IEnumerable<MetricToggleItemViewModel> items, ISet<string> selected)
    {
        foreach (var item in items)
        {
            item.SetIsEnabledSilently(selected.Contains(item.Key));
        }
    }

    private void NotifyMetricSummaryChanged(string? propertyName = null)
    {
        if (string.IsNullOrWhiteSpace(propertyName) || string.Equals(propertyName, nameof(CpuEnabled), StringComparison.Ordinal) || string.Equals(propertyName, "cpu", StringComparison.OrdinalIgnoreCase))
        {
            OnPropertyChanged(nameof(CpuMetricSummary));
        }

        if (string.IsNullOrWhiteSpace(propertyName) || string.Equals(propertyName, nameof(MemoryEnabled), StringComparison.Ordinal) || string.Equals(propertyName, "memory", StringComparison.OrdinalIgnoreCase))
        {
            OnPropertyChanged(nameof(MemoryMetricSummary));
        }

        if (string.IsNullOrWhiteSpace(propertyName) || string.Equals(propertyName, nameof(DiskEnabled), StringComparison.Ordinal) || string.Equals(propertyName, "disk", StringComparison.OrdinalIgnoreCase))
        {
            OnPropertyChanged(nameof(DiskMetricSummary));
        }

        if (string.IsNullOrWhiteSpace(propertyName) || string.Equals(propertyName, nameof(NetworkEnabled), StringComparison.Ordinal) || string.Equals(propertyName, "network", StringComparison.OrdinalIgnoreCase))
        {
            OnPropertyChanged(nameof(NetworkMetricSummary));
        }

        if (string.IsNullOrWhiteSpace(propertyName) || string.Equals(propertyName, nameof(GpuEnabled), StringComparison.Ordinal) || string.Equals(propertyName, "gpu", StringComparison.OrdinalIgnoreCase))
        {
            OnPropertyChanged(nameof(GpuMetricSummary));
        }
    }

    private static string BuildMetricSummary(string blockLabel, IEnumerable<MetricToggleItemViewModel> items, bool blockEnabled)
    {
        if (!blockEnabled)
        {
            return $"{blockLabel} 类别当前已关闭，相关指标不会再发送或展示。";
        }

        var materialized = items.ToList();
        var enabledCount = materialized.Count(item => item.IsEnabled);
        return enabledCount == 0
            ? $"{blockLabel} 类别仍保持开启，但当前没有勾选任何具体指标。"
            : $"{blockLabel} 类别当前启用 {enabledCount} / {materialized.Count} 个具体指标。";
    }

    private static string ResolveMetricLabel(string key)
    {
        return MetricLabels.TryGetValue(key, out var label)
            ? label
            : key;
    }

    private static string BuildCurrentOperationText(string? operationCode)
    {
        return operationCode switch
        {
            "start" => "正在启动采集器。",
            "stop" => "正在停止采集器。",
            "check-connection" => "正在检查中枢连接。",
            "toggle-realtime" => "正在切换实时模式。",
            "detect" => "正在刷新组件探测结果。",
            "push-cloud" => "正在把展示配置推送到中枢。",
            _ => "当前没有正在执行的本地操作。"
        };
    }

    private static string BuildCurrentOperationDetailText(string? operationCode)
    {
        return operationCode switch
        {
            "start" => "WinUI 会先确保当前界面配置已经写入本地 backend，再启动采集器进程。",
            "stop" => "本次操作会请求本地 backend 优雅停止采集器，而不是直接强制结束进程树。",
            "check-connection" => "本次操作会检查 Server URL、Agent Secret 和设备识别状态，帮助区分不可达、鉴权失败和设备未出现等问题。",
            "toggle-realtime" => "本次操作会把本地上传模式切换到实时或常态，并等待 backend 返回最新状态。",
            "detect" => "本次操作会基于当前本地配置刷新探测方案和实例清单，避免显示过期的 CPU、磁盘或网卡实例。",
            "push-cloud" => "本次操作会显式调用中枢接口同步展示配置，不会影响本地自动保存策略。",
            _ => "你可以继续修改连接信息、频次、探测方案和实例开关；当没有操作进行中时，相关按钮会恢复可用。"
        };
    }

    private static string ResolveBackendRecoveryAlertTitle(string? value)
    {
        return value?.Trim().ToLowerInvariant() switch
        {
            "recovering" => "WinUI 正在自动恢复本地 backend",
            "waiting" => "WinUI 正在等待本地 backend 恢复",
            "recovered" => "本地 backend 已自动恢复",
            _ => "本地 backend 运行稳定"
        };
    }

    private static string ResolveControlStreamAlertTitle(string? value)
    {
        return value?.Trim().ToLowerInvariant() switch
        {
            "connected" => "中枢实时控制链路已连通",
            "connected-keepalive" => "中枢实时控制链路保活正常",
            "recovering" => "中枢实时控制链路正在主动重连",
            "fallback" => "中枢实时控制链路已回退到轮询",
            "waiting" => "正在等待本地控制链路恢复",
            "idle" => "中枢实时控制链路尚未建立",
            _ => "中枢实时控制链路状态待确认"
        };
    }

    private static string ResolveControlStreamSpotlightKicker(string? value)
    {
        return value?.Trim().ToLowerInvariant() switch
        {
            "connected-keepalive" => "CONTROL STREAM · KEEPALIVE",
            "recovering" => "CONTROL STREAM · RECOVERING",
            "fallback" => "CONTROL STREAM · FALLBACK",
            "idle" => "CONTROL STREAM · CONNECTING",
            _ => "CONTROL STREAM · STATUS"
        };
    }

    private static string ResolveControlStreamSpotlightHeadline(string? value)
    {
        return value?.Trim().ToLowerInvariant() switch
        {
            "connected-keepalive" => "主动推送链路保活正常",
            "recovering" => "主动推送链路静默超时，正在主动重连",
            "fallback" => "主动推送暂不可用，当前已回退轮询",
            "idle" => "正在等待建立主动推送链路",
            _ => "主动推送链路状态待确认"
        };
    }

    private static (string Category, string Suggestion) ClassifyControlStreamIssue(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return ("none", "");
        }

        var normalized = value.Trim();
        if (string.Equals(normalized, "missing_connection_config", StringComparison.OrdinalIgnoreCase))
        {
            return ("config", "补全 Server URL、Agent Secret 和 Device ID 后，重新检查中枢连接。");
        }

        if (normalized.StartsWith("build_control_stream_url_failed:", StringComparison.OrdinalIgnoreCase) ||
            normalized.StartsWith("build_control_stream_request_failed:", StringComparison.OrdinalIgnoreCase))
        {
            return ("config", "检查 Server URL 格式是否正确，确认协议、端口和路径没有写错。");
        }

        if (normalized.StartsWith("connect_control_stream_failed:", StringComparison.OrdinalIgnoreCase))
        {
            return ("network", "检查当前设备到中枢的网络连通性、防火墙或代理设置；恢复后 backend 会自动重连。");
        }

        if (normalized.StartsWith("control_stream_stale_for_", StringComparison.OrdinalIgnoreCase))
        {
            return ("stale", "当前旧连接已被 backend 主动取消，通常无需手动处理；若频繁出现，可检查 Windows 网络空闲超时、代理保活策略或休眠恢复后的网络状态。");
        }

        if (normalized.StartsWith("control_stream_status_", StringComparison.OrdinalIgnoreCase))
        {
            var statusCode = normalized["control_stream_status_".Length..].Trim();
            return statusCode switch
            {
                "401" => ("config", "重新核对 Agent Secret 是否与中枢一致，然后再次检查中枢连接。"),
                "403" => ("config", "检查中枢访问策略、反向代理或鉴权配置，确认当前 agent 被允许建立主动推送链路。"),
                "404" => ("capability", "当前中枢未提供主动推送接口，可先继续使用回退轮询；若需要更实时的控制，请升级或补齐服务端接口。"),
                "502" => ("server", "检查中枢前置网关或反向代理状态，待网关恢复后主动推送链路会自动重连。"),
                "503" => ("server", "检查中枢服务当前是否可用，待服务恢复后主动推送链路会自动重连。"),
                "504" => ("network", "检查中枢链路超时、网关超时或网络质量问题；恢复后主动推送链路会自动重连。"),
                _ => ("server", $"检查中枢接口为什么返回状态 {statusCode}，确认服务端接口和代理配置是否正常。")
            };
        }

        if (normalized.StartsWith("control_stream_disconnected:", StringComparison.OrdinalIgnoreCase))
        {
            return ("network", "检查网络稳定性、代理空闲超时或休眠恢复后的连接状态；backend 会持续重试主动推送链路。");
        }

        if (string.Equals(normalized, "control_stream_closed_by_server", StringComparison.OrdinalIgnoreCase))
        {
            return ("server", "检查中枢为什么主动关闭了连接，例如服务重启、连接策略或会话回收；backend 会自动重连。");
        }

        return ("server", "检查中枢日志和本地诊断日志，确认主动推送链路为何断开。");
    }

    private static string ResolveControlStreamErrorLabel(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return "";
        }

        var normalized = value.Trim();
        if (string.Equals(normalized, "missing_connection_config", StringComparison.OrdinalIgnoreCase))
        {
            return "本地连接信息尚未填写完整，暂时无法建立中枢主动推送链路";
        }

        if (normalized.StartsWith("build_control_stream_url_failed:", StringComparison.OrdinalIgnoreCase))
        {
            var detail = normalized["build_control_stream_url_failed:".Length..].Trim();
            return string.IsNullOrWhiteSpace(detail)
                ? "构造中枢主动推送地址失败"
                : $"构造中枢主动推送地址失败：{detail}";
        }

        if (normalized.StartsWith("build_control_stream_request_failed:", StringComparison.OrdinalIgnoreCase))
        {
            var detail = normalized["build_control_stream_request_failed:".Length..].Trim();
            return string.IsNullOrWhiteSpace(detail)
                ? "创建中枢主动推送请求失败"
                : $"创建中枢主动推送请求失败：{detail}";
        }

        if (normalized.StartsWith("connect_control_stream_failed:", StringComparison.OrdinalIgnoreCase))
        {
            var detail = normalized["connect_control_stream_failed:".Length..].Trim();
            return string.IsNullOrWhiteSpace(detail)
                ? "连接中枢主动推送通道失败"
                : $"连接中枢主动推送通道失败：{detail}";
        }

        if (normalized.StartsWith("control_stream_stale_for_", StringComparison.OrdinalIgnoreCase))
        {
            var detail = normalized["control_stream_stale_for_".Length..].Trim();
            if (string.IsNullOrWhiteSpace(detail))
            {
                return "中枢主动推送链路长时间未收到新快照，backend 已主动取消旧连接并准备重连";
            }

            var formatted = detail.Replace("_lastKind_", "，最近快照类型=");
            formatted = formatted.Replace("_", " ");
            return $"中枢主动推送链路长时间未收到新快照，backend 已主动取消旧连接并准备重连：{formatted}";
        }

        if (normalized.StartsWith("control_stream_status_", StringComparison.OrdinalIgnoreCase))
        {
            var statusCode = normalized["control_stream_status_".Length..].Trim();
            return statusCode switch
            {
                "401" => "中枢拒绝了主动推送连接，请检查 Agent Secret 是否正确",
                "403" => "中枢禁止了主动推送连接，请检查访问权限或代理策略",
                "404" => "中枢当前未提供主动推送接口，已自动回退到低频轮询",
                "502" => "中枢网关暂时不可用，主动推送链路已回退到低频轮询",
                "503" => "中枢服务暂时不可用，主动推送链路已回退到低频轮询",
                "504" => "中枢主动推送链路连接超时，已回退到低频轮询",
                _ => $"中枢主动推送接口返回异常状态 {statusCode}"
            };
        }

        if (normalized.StartsWith("control_stream_disconnected:", StringComparison.OrdinalIgnoreCase))
        {
            var detail = normalized["control_stream_disconnected:".Length..].Trim();
            return string.IsNullOrWhiteSpace(detail)
                ? "中枢主动推送链路在运行中断开"
                : $"中枢主动推送链路在运行中断开：{detail}";
        }

        if (string.Equals(normalized, "control_stream_closed_by_server", StringComparison.OrdinalIgnoreCase))
        {
            return "中枢主动关闭了推送链路，backend 已自动回退到低频轮询";
        }

        return normalized;
    }

    private static bool IsControlStreamRecovering(string? value)
    {
        return !string.IsNullOrWhiteSpace(value) &&
               value.Trim().StartsWith("control_stream_stale_for_", StringComparison.OrdinalIgnoreCase);
    }

    private static bool HasFrequentControlStreamReconnects(BackendStateDto state)
    {
        return state.ControlStreamReconnectCount >= 3;
    }

    private static string BuildControlStreamAlertDetail(string? statusCode, string stateText, string lastDisconnectText, string categoryText, string errorText, string actionText, string transportText)
    {
        return statusCode?.Trim().ToLowerInvariant() switch
        {
            "connected" => $"{stateText} {transportText} {actionText}".Trim(),
            "recovering" => $"{stateText} {lastDisconnectText} {categoryText} {errorText} {actionText} {transportText}".Trim(),
            "fallback" => $"{stateText} {lastDisconnectText} {categoryText} {errorText} {actionText} {transportText}".Trim(),
            "waiting" => $"{stateText} {categoryText} {actionText} {transportText}".Trim(),
            "idle" => $"{stateText} {categoryText} {actionText} {transportText}".Trim(),
            _ => stateText
        };
    }

    private static string FormatRealtimeExpiry(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return "稍后";
        }

        if (!DateTimeOffset.TryParse(value, out var parsed))
        {
            return value;
        }

        return parsed.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss");
    }

    private string BuildInstanceSummary(string label, IEnumerable<ProbeInstanceItemViewModel> items)
    {
        var materialized = items.ToList();
        if (materialized.Count == 0)
        {
            return string.IsNullOrWhiteSpace(_detectStatusText) || _detectStatusText.StartsWith("尚未执行组件探测", StringComparison.Ordinal)
                ? $"尚未执行组件探测。执行后，这里会列出可单独开关的{label}实例。"
                : $"最近一次探测没有返回可配置的{label}实例。可以更换探测方案后重新探测。";
        }

        var enabledCount = materialized.Count(item => item.IsEnabled);
        return $"已发现 {materialized.Count} 个{label}实例，当前启用 {enabledCount} 个。";
    }

    private static string BuildDetectStatusText(BackendStateDto state)
    {
        var detectedCount = CountDetectedInstances(state.DetectedTargets);
        if (string.IsNullOrWhiteSpace(state.LastDetectAt))
        {
            return "尚未执行组件探测，当前实例清单还不可用。";
        }

        return BuildDetectStatusText(detectedCount, DateTimeOffset.TryParse(state.LastDetectAt, out var parsed) ? parsed : null);
    }

    private static string BuildDetectStatusText(int detectedCount, DateTimeOffset? detectedAt)
    {
        var whenText = detectedAt.HasValue
            ? $"最近探测：{detectedAt.Value.ToLocalTime():yyyy-MM-dd HH:mm:ss}"
            : "最近一次组件探测已完成";

        return detectedCount > 0
            ? $"{whenText}，已发现 {detectedCount} 个可配置实例。"
            : $"{whenText}，但尚未发现可配置实例。";
    }

    private static int CountDetectedInstances(IEnumerable<ProbeTargetStateDto>? targets)
    {
        return targets?.Sum(item => item?.Instances?.Count ?? 0) ?? 0;
    }

    private static string BuildConnectionCheckText(ConnectionCheckResultDto result)
    {
        var summary = string.IsNullOrWhiteSpace(result.Message)
            ? "本地 backend 没有返回连接检查说明。"
            : result.Message.Trim();
        if (!string.IsNullOrWhiteSpace(result.ServerTime))
        {
            summary += $" 中枢时间：{FormatRealtimeExpiry(result.ServerTime)}。";
        }

        return result.Status switch
        {
            "authorized_device_known" => $"{summary} 当前设备已经在中枢可见。",
            "authorized_device_unknown" => $"{summary} 这通常意味着连接信息正确，但还需要先启动采集器上报一次。",
            "unauthorized" => $"{summary} 请重点检查 Agent Secret。",
            "server_unreachable" => $"{summary} 请检查 Server URL、网络连通性或中枢服务是否已启动。",
            _ => summary
        };
    }

    private static string BuildConnectionCheckDetailText(ConnectionCheckResultDto result)
    {
        return result.Status switch
        {
            "authorized_device_known" => "当前这台设备已经被中枢识别，后续可以直接启动采集器或继续调整本地配置。",
            "authorized_device_unknown" => "当前连接与鉴权都正确，但中枢还没有这台设备的实时记录；通常只需要启动采集器并完成首次上报。",
            "unauthorized" => "中枢地址可达，但 Agent Secret 未通过校验。请确认它与中枢侧 AGENT_SHARED_SECRET 完全一致。",
            "server_unreachable" => "本地 backend 未能连到中枢。请优先检查 Server URL、端口、网络路径以及中枢服务是否已启动。",
            "server_error" => "中枢已响应，但返回了异常状态。通常需要结合中枢日志继续排查。",
            "missing_server_url" => "当前还没有可用的 Server URL，先完成连接信息后再执行检查。",
            "missing_secret" => "当前还没有可用的 Agent Secret，先完成连接信息后再执行检查。",
            "missing_device_id" => "当前还没有可用的 Device ID，先完成连接信息后再执行检查。",
            _ => "连接检查会区分中枢不可达、密钥错误、设备尚未出现和设备已被中枢识别。"
        };
    }

    private static string ResolveConnectionCheckStatusCode(ConnectionCheckResultDto result)
    {
        return result.Status switch
        {
            "authorized_device_known" => "success",
            "authorized_device_unknown" => "warning",
            "unauthorized" => "error",
            "server_unreachable" => "error",
            "server_error" => "error",
            "missing_server_url" => "warning",
            "missing_secret" => "warning",
            "missing_device_id" => "warning",
            _ when result.Ok => "success",
            _ => "warning"
        };
    }

    private static string ResolveConnectionCheckAlertTitle(string? value)
    {
        return value?.Trim().ToLowerInvariant() switch
        {
            "success" => "中枢连接检查通过",
            "error" => "中枢连接检查失败",
            "warning" => "中枢连接需要进一步处理",
            _ => "中枢连接尚未检查"
        };
    }

    private static bool IsProbeEnabled(IEnumerable<AgentProbeSelection> selections, string target)
        => selections.FirstOrDefault(item => item.Target == target)?.Enabled ?? false;

    private static string ResolveProvider(IEnumerable<AgentProbeSelection> selections, string target, string fallback)
    {
        var provider = selections.FirstOrDefault(item => item.Target == target)?.Provider;
        return string.IsNullOrWhiteSpace(provider) ? fallback : provider;
    }

    private static string ResolveSupportedProvider(
        IEnumerable<AgentProbeSelection> selections,
        string target,
        IReadOnlyList<ProbeProviderOptionViewModel> options)
    {
        var configured = ResolveProvider(selections, target, "disabled");
        return options.Any(option => string.Equals(option.Key, configured, StringComparison.OrdinalIgnoreCase))
            ? configured
            : "disabled";
    }

    private static IReadOnlyList<ProbeProviderOptionViewModel> ResolvePlanOptions(IEnumerable<ProbePlanSupport> plans, string target, string fallback)
    {
        var resolved = plans.FirstOrDefault(item => item.Target == target)?.Providers
            ?.Where(item => !string.IsNullOrWhiteSpace(item))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (resolved is { Count: > 0 })
        {
            resolved.RemoveAll(item => string.Equals(item, "disabled", StringComparison.OrdinalIgnoreCase));
            resolved.Insert(0, "disabled");
            return resolved.Select(ProbeProviderOptionViewModel.FromKey).ToList();
        }

        var fallbackKeys = new List<string> { "disabled" };
        if (!string.Equals(fallback, "disabled", StringComparison.OrdinalIgnoreCase))
        {
            fallbackKeys.Add(fallback);
        }

        return fallbackKeys.Select(ProbeProviderOptionViewModel.FromKey).ToList();
    }

    private static string NormalizeProvider(string? value, string fallback)
    {
        return string.IsNullOrWhiteSpace(value) ? fallback : value.Trim();
    }

    private bool SetProvider(
        ref string storage,
        string value,
        string propertyName,
        Action<bool> setEnabled,
        bool markCloudDisplayDirty = false)
    {
        if (!SetAndQueueSave(ref storage, value, markCloudDisplayDirty, propertyName))
        {
            return false;
        }

        if (!_isApplyingState)
        {
            setEnabled(!string.Equals(value, "disabled", StringComparison.OrdinalIgnoreCase));
        }

        return true;
    }

    private static string ResolveIssueCategoryLabel(string? category)
    {
        if (string.IsNullOrWhiteSpace(category))
        {
            return "未知异常";
        }

        return IssueCategoryLabels.TryGetValue(category.Trim(), out var label)
            ? label
            : "未知异常";
    }

    private static string ResolveTargetLabel(string target)
    {
        return target.Trim().ToLowerInvariant() switch
        {
            "cpu" => "CPU",
            "disk" => "磁盘",
            "network" => "网卡",
            "gpu" => "显卡",
            "memory" => "内存",
            "fan" => "风扇",
            _ => target
        };
    }

}

public sealed class ProbeInstanceItemViewModel : ObservableObject
{
    private readonly Action<ProbeInstanceItemViewModel> _onChanged;
    private bool _isEnabled;

    public ProbeInstanceItemViewModel(string target, string id, string name, string subtitle, string reportedMetrics, bool isEnabled, bool supportsMetricEditing, Action<ProbeInstanceItemViewModel> onChanged)
    {
        Target = target;
        Id = id;
        Name = name;
        Subtitle = subtitle;
        ReportedMetrics = reportedMetrics;
        SupportsMetricEditing = supportsMetricEditing;
        _isEnabled = isEnabled;
        _onChanged = onChanged;
    }

    public string Target { get; }
    public string Id { get; }
    public string Name { get; }
    public string Subtitle { get; }
    public string ReportedMetrics { get; }
    public bool SupportsMetricEditing { get; }

    public bool IsEnabled
    {
        get => _isEnabled;
        set
        {
            if (!SetProperty(ref _isEnabled, value))
            {
                return;
            }

            _onChanged(this);
        }
    }
}

public sealed class ProbeInstanceGroupViewModel : ObservableObject
{
    private readonly Func<string> _summaryAccessor;

    public ProbeInstanceGroupViewModel(string title, ObservableCollection<ProbeInstanceItemViewModel> items, Func<string> summaryAccessor)
    {
        Title = title;
        Items = items;
        _summaryAccessor = summaryAccessor;
    }

    public string Title { get; }
    public ObservableCollection<ProbeInstanceItemViewModel> Items { get; }
    public string Summary => _summaryAccessor();

    public void NotifySummaryChanged()
    {
        OnPropertyChanged(nameof(Summary));
    }
}

public sealed class MetricToggleItemViewModel : ObservableObject
{
    private readonly Action<MetricToggleItemViewModel> _onChanged;
    private bool _isEnabled;
    private bool _suppressCallback;

    public MetricToggleItemViewModel(string blockKey, string key, string label, bool isEnabled, Action<MetricToggleItemViewModel> onChanged)
    {
        BlockKey = blockKey;
        Key = key;
        Label = label;
        _isEnabled = isEnabled;
        _onChanged = onChanged;
    }

    public string BlockKey { get; }
    public string Key { get; }
    public string Label { get; }

    public bool IsEnabled
    {
        get => _isEnabled;
        set
        {
            if (!SetProperty(ref _isEnabled, value))
            {
                return;
            }

            if (!_suppressCallback)
            {
                _onChanged(this);
            }
        }
    }

    public void SetIsEnabledSilently(bool value)
    {
        _suppressCallback = true;
        try
        {
            IsEnabled = value;
        }
        finally
        {
            _suppressCallback = false;
        }
    }
}

public sealed class ViewerDeviceItemViewModel : ObservableObject
{
    public ViewerDeviceItemViewModel(ViewerDeviceSummaryDto source)
    {
        DeviceId = source.DeviceId;
        Hostname = string.IsNullOrWhiteSpace(source.Hostname) ? source.DeviceId : source.Hostname;
        StatusText = source.Status.Equals("online", StringComparison.OrdinalIgnoreCase) ? "在线" : "离线";
        StatusGlyph = source.Status.Equals("online", StringComparison.OrdinalIgnoreCase) ? "●" : "○";
        CpuText = FormatPercent("CPU", source.CpuUsagePercent);
        MemoryText = FormatPercent("内存", source.MemoryUsagePercent);
        DiskText = FormatPercent("磁盘", source.DiskUsagePercent);
        GpuText = FormatPercent("显卡", source.GpuUsagePercent);
        LastSeenText = string.IsNullOrWhiteSpace(source.LastSeenAt) ? "暂无更新时间" : $"更新于 {source.LastSeenAt}";
    }

    public string DeviceId { get; }
    public string Hostname { get; }
    public string StatusText { get; }
    public string StatusGlyph { get; }
    public string CpuText { get; }
    public string MemoryText { get; }
    public string DiskText { get; }
    public string GpuText { get; }
    public string LastSeenText { get; }

    private static string FormatPercent(string label, double? value)
        => value.HasValue ? $"{label} {value.Value:0.0}%" : $"{label} --";
}

public sealed class TrendPointViewModel
{
    public TrendPointViewModel(double value, string timestamp)
    {
        Value = value;
        Timestamp = timestamp;
    }

    public double Value { get; }
    public string Timestamp { get; }
}

public enum ViewerMetricValueKind
{
    Percent,
    Megahertz,
    Celsius,
    Rate,
    Bytes,
    Rpm
}

public sealed class ViewerDetailChartViewModel
{
    public ViewerDetailChartViewModel(string title, string subtitle, string metric, IReadOnlyList<ViewerSamplePointDto> points, ViewerMetricValueKind valueKind)
    {
        Title = title;
        Subtitle = string.IsNullOrWhiteSpace(subtitle) ? metric : $"{subtitle} · {metric}";
        ValueKind = valueKind;
        Points = points.Select(point => new ViewerDetailChartPoint(point.Value, point.Timestamp)).ToList();
        if (Points.Count == 0)
        {
            Minimum = 0;
            Maximum = 0;
            PlotMinimum = 0;
            PlotMaximum = 1;
            CurrentText = "暂无数据";
            RangeText = "暂无历史数据";
            StartTimeText = "";
            EndTimeText = "";
            return;
        }

        Minimum = Points.Min(point => point.Value);
        Maximum = Points.Max(point => point.Value);
        PlotMinimum = ValueKind == ViewerMetricValueKind.Celsius ? Math.Min(0, Minimum) : 0;
        PlotMaximum = CalculatePlotMaximum(Maximum, ValueKind);
        CurrentText = FormatValue(Points[^1].Value);
        RangeText = $"最大 {FormatValue(Maximum)} · 最小 {FormatValue(Minimum)}";
        StartTimeText = Points[0].TimestampText;
        EndTimeText = Points[^1].TimestampText;
    }

    public string Title { get; }
    public string Subtitle { get; }
    public ViewerMetricValueKind ValueKind { get; }
    public IReadOnlyList<ViewerDetailChartPoint> Points { get; }
    public double Minimum { get; }
    public double Maximum { get; }
    public double PlotMinimum { get; }
    public double PlotMaximum { get; }
    public string CurrentText { get; }
    public string RangeText { get; }
    public string StartTimeText { get; }
    public string EndTimeText { get; }
    public string YAxisTopText => FormatValue(PlotMaximum);
    public string YAxisMiddleText => FormatValue((PlotMinimum + PlotMaximum) / 2);
    public string YAxisBottomText => FormatValue(PlotMinimum);

    public string FormatValue(double value) => ValueKind switch
    {
        ViewerMetricValueKind.Percent => $"{value:0.0}%",
        ViewerMetricValueKind.Megahertz => $"{value:0} MHz",
        ViewerMetricValueKind.Celsius => $"{value:0.0}°C",
        ViewerMetricValueKind.Rate => FormatRate(value),
        ViewerMetricValueKind.Bytes => FormatBytes(value),
        ViewerMetricValueKind.Rpm => $"{value:0} RPM",
        _ => value.ToString("0.##")
    };

    private static string FormatBytes(double value)
    {
        if (value >= 1024 * 1024 * 1024) return $"{value / 1024 / 1024 / 1024:0.00} GB";
        if (value >= 1024 * 1024) return $"{value / 1024 / 1024:0.0} MB";
        return $"{value / 1024:0.0} KB";
    }

    private static string FormatRate(double value) => $"{FormatBytes(value)}/s";

    private static double CalculatePlotMaximum(double maximum, ViewerMetricValueKind valueKind)
    {
        if (valueKind == ViewerMetricValueKind.Percent)
        {
            return 100;
        }

        var padded = Math.Max(1, maximum * 1.1);
        var magnitude = Math.Pow(10, Math.Floor(Math.Log10(padded)));
        return Math.Ceiling(padded / magnitude) * magnitude;
    }
}

public sealed class ViewerDetailChartPoint
{
    public ViewerDetailChartPoint(double value, string timestamp)
    {
        Value = value;
        Timestamp = timestamp;
        TimestampText = DateTimeOffset.TryParse(timestamp, out var parsed)
            ? parsed.LocalDateTime.ToString("MM-dd HH:mm:ss")
            : timestamp;
    }

    public double Value { get; }
    public string Timestamp { get; }
    public string TimestampText { get; }
}

public sealed class ProbeProviderOptionViewModel
{
    private ProbeProviderOptionViewModel(string key, string label)
    {
        Key = key;
        Label = label;
    }

    public static ProbeProviderOptionViewModel Builtin { get; } = new("builtin", "系统内置采集器");
    public static ProbeProviderOptionViewModel Disabled { get; } = new("disabled", "不使用");
    public static ProbeProviderOptionViewModel Gopsutil { get; } = new("gopsutil", "gopsutil 系统传感器");
    public static ProbeProviderOptionViewModel Wmi { get; } = new("wmi", "Windows WMI");

    public string Key { get; }
    public string Label { get; }

    public static ProbeProviderOptionViewModel FromKey(string key)
    {
        return key.Trim().ToLowerInvariant() switch
        {
            "builtin" => Builtin,
            "gopsutil" => Gopsutil,
            "disabled" => Disabled,
            "wmi" => Wmi,
            "librehardwaremonitor" => new ProbeProviderOptionViewModel("libreHardwareMonitor", "LibreHardwareMonitor"),
            "openhardwaremonitor" => new ProbeProviderOptionViewModel("openHardwareMonitor", "OpenHardwareMonitor"),
            "redfish" => new ProbeProviderOptionViewModel("redfish", "Redfish"),
            _ => new ProbeProviderOptionViewModel(key, key)
        };
    }
}
