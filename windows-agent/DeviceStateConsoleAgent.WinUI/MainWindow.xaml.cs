using DeviceStateConsoleAgent.WinUI.Common;
using DeviceStateConsoleAgent.WinUI.ViewModels;
using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.Web.WebView2.Core;
using System.Runtime.InteropServices;
using System.Collections.ObjectModel;
using System.Text.Json;
using WinRT.Interop;
using Windows.UI;
using Windows.Foundation;
using Polyline = Microsoft.UI.Xaml.Shapes.Polyline;

namespace DeviceStateConsoleAgent.WinUI;

public sealed partial class MainWindow : Window
{
    private readonly MainViewModel _viewModel;
    private Microsoft.UI.Windowing.AppWindow? _appWindow;
    private bool _allowClose;
    private bool _appWindowInitialized;
    private bool _initialized;
    private bool _isCompactLayout;
    private bool _hubLoginStarted;
    private bool _metricConfigDialogOpen;
    private string _hubPageStatus = "网页状态：等待打开观澜";
    private string _currentSelectedCategory = "cpu";

    public MainWindow(MainViewModel viewModel)
    {
        _viewModel = viewModel;
        InitializeComponent();
        HubWebView.NavigationCompleted += HubWebView_NavigationCompleted;
        ExtendsContentIntoTitleBar = true;
        SetTitleBar(AppTitleBar);
        ApplySystemBackdrop();
        RootLayout.DataContext = _viewModel;

        SubscribeTrend(_viewModel.ViewerCpuTrendPoints);
        SubscribeTrend(_viewModel.ViewerMemoryTrendPoints);
        SubscribeTrend(_viewModel.ViewerDiskTrendPoints);
        SubscribeTrend(_viewModel.ViewerGpuTrendPoints);
        SubscribeTrend(_viewModel.ViewerNetworkTrendPoints);
        SubscribeTrend(_viewModel.ViewerFanTrendPoints);
        SubscribeTrend(_viewModel.ViewerTrafficTrendPoints);

        AppNavigation.Loaded += (_, _) =>
        {
            AppNavigation.PaneDisplayMode = NavigationViewPaneDisplayMode.Left;
            AppNavigation.IsPaneOpen = true;
        };

        RootLayout.ActualThemeChanged += (_, _) => ApplyTitleBarTheme();

        _viewModel.FilteredViewerDevices.CollectionChanged += (_, _) => DispatcherQueue.TryEnqueue(SyncDeviceMenuItems);

        _viewModel.PropertyChanged += (_, args) =>
        {
            if (args.PropertyName == nameof(MainViewModel.Secret) && SecretBox.Password != _viewModel.Secret)
            {
                SecretBox.Password = _viewModel.Secret;
            }
            if (args.PropertyName is nameof(MainViewModel.ConnectionText)
                or nameof(MainViewModel.TraySubmitStatusText)
                or nameof(MainViewModel.TraySubmitDetailText)
                or nameof(MainViewModel.StatusText))
            {
                DispatcherQueue.TryEnqueue(UpdateHubStatusText);
            }
        };

        SecretBox.Password = _viewModel.Secret;
        UpdateHubStatusText();
    }

    public async Task EnsureInitializedAsync()
    {
        if (_initialized) return;
        _initialized = true;
        EnsureAppWindow();
        await _viewModel.InitializeAsync();
        UpdateHubStatusText();
        if (!string.IsNullOrWhiteSpace(_viewModel.ServerUrl) && !string.IsNullOrWhiteSpace(_viewModel.Secret))
        {
            await OpenHubAsync();
        }
        else
        {
            ShowBackendUnavailable();
        }
        DispatcherQueue.TryEnqueue(() => ApplyResponsiveLayout(RootLayout.ActualWidth < 900));
    }

    public void PrepareForExit()
    {
        _allowClose = true;
    }

    public void ShowWindow()
    {
        EnsureAppWindow();
        _appWindow?.Show();
        var hwnd = WindowNative.GetWindowHandle(this);
        ShowWindowNative(hwnd, SwRestore);
        BringWindowToTop(hwnd);
        SetForegroundWindow(hwnd);
        Activate();
    }

    public void HideWindow()
    {
        EnsureAppWindow();
        var hwnd = WindowNative.GetWindowHandle(this);
        ShowWindowNative(hwnd, SwHide);
    }

    private void SyncDeviceMenuItems()
    {
        // Device status is now provided by the hub web application inside WebView2.
        // Keep this method as a no-op for compatibility with existing collection hooks.
        return;
        /*var desiredDevices = _viewModel.FilteredViewerDevices.ToList();
        var desiredTags = desiredDevices
            .Select(device => $"device_{device.DeviceId}")
            .ToHashSet(StringComparer.Ordinal);
        var existingDynamicItems = AppNavigation.MenuItems
            .OfType<NavigationViewItem>()
            .Where(item => (item.Tag as string)?.StartsWith("device_", StringComparison.Ordinal) == true)
            .ToList();

        foreach (var item in existingDynamicItems)
        {
            if (!desiredTags.Contains(item.Tag as string ?? string.Empty))
            {
                AppNavigation.MenuItems.Remove(item);
            }
        }*/
        /*

        var firstDynamicIndex = AppNavigation.MenuItems
            .Select((item, index) => new { item, index })
            .Where(entry => entry.item is NavigationViewItem navigationItem &&
                            (navigationItem.Tag as string)?.StartsWith("device_", StringComparison.Ordinal) == true)
            .Select(entry => entry.index)
            .DefaultIfEmpty(AppNavigation.MenuItems.Count)
            .First();

        for (var index = 0; index < desiredDevices.Count; index++)
        {
            var device = desiredDevices[index];
            var tag = $"device_{device.DeviceId}";
            var item = AppNavigation.MenuItems
                .OfType<NavigationViewItem>()
                .FirstOrDefault(candidate => string.Equals(candidate.Tag as string, tag, StringComparison.Ordinal));
            if (item is null)
            {
                item = new NavigationViewItem
                {
                    Content = device.Hostname,
                    Tag = tag,
                    Icon = new FontIcon { Glyph = "\uE7F8" }
                };
            }
            else
            {
                item.Content = device.Hostname;
            }

            var targetIndex = firstDynamicIndex + index;
            var currentIndex = AppNavigation.MenuItems.ToList().IndexOf(item);
            if (currentIndex != targetIndex)
            {
                if (currentIndex >= 0)
                {
                    AppNavigation.MenuItems.Remove(item);
                }

                AppNavigation.MenuItems.Insert(Math.Min(targetIndex, AppNavigation.MenuItems.Count), item);
            }
        }
        */
    }

    private void NavigationView_SelectionChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
    {
        if (args.SelectedItem is not NavigationViewItem selectedItem) return;
        var tag = selectedItem.Tag as string ?? "";

        OverviewPage.Visibility = Visibility.Collapsed;
        SettingsPage.Visibility = Visibility.Collapsed;

        if (tag == "settings")
        {
            SettingsPage.Visibility = Visibility.Visible;
        }
    }

    private void TaskManagerCategoryListView_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (TaskManagerCategoryListView?.SelectedItem is ViewerSidebarItemViewModel selectedItem)
        {
            _viewModel.SelectViewerSidebarItem(selectedItem);
            SwitchCategory(selectedItem.Category);
            _viewModel.SelectViewerSidebarItem(selectedItem);
        }
    }

    private void SwitchCategory(string categoryTag)
    {
        if (TaskManagerCategoryTitle is null || _viewModel is null) return;

        _currentSelectedCategory = categoryTag;
        _viewModel.SelectedViewerCategory = categoryTag;
        var currentDev = _viewModel.FilteredViewerDevices.FirstOrDefault(d => d.DeviceId == _viewModel.SelectedViewerDeviceId)
                      ?? _viewModel.ViewerDevices.FirstOrDefault(d => d.DeviceId == _viewModel.SelectedViewerDeviceId);

        switch (categoryTag.ToLowerInvariant())
        {
            case "cpu":
                TaskManagerCategoryTitle.Text = "CPU";
                _viewModel.TaskManagerStatLabel1 = "利用率";
                _viewModel.TaskManagerStatLabel2 = "速度 / 频率";
                _viewModel.TaskManagerStatLabel3 = "内核 / 线程";
                _viewModel.TaskManagerStatLabel4 = "运行进程";
                _viewModel.TaskManagerStatLabel5 = "系统线程";
                _viewModel.TaskManagerStatLabel6 = "句柄数";

                _viewModel.TaskManagerRightLabel1 = "基准速度:"; _viewModel.TaskManagerRightValue1 = "--";
                _viewModel.TaskManagerRightLabel2 = "物理内核:"; _viewModel.TaskManagerRightValue2 = "--";
                _viewModel.TaskManagerRightLabel3 = "逻辑处理器:"; _viewModel.TaskManagerRightValue3 = "--";

                _viewModel.CurrentCategoryCharts = _viewModel.ViewerCpuCharts;
                _viewModel.SelectedCategoryChart = System.Linq.Enumerable.FirstOrDefault(_viewModel.ViewerCpuCharts);
                _viewModel.TaskManagerStatUsage = currentDev is not null && !string.IsNullOrWhiteSpace(currentDev.CpuText) && currentDev.CpuText != "CPU: --"
                    ? currentDev.CpuText.Replace("CPU ", "")
                    : "--";
                _viewModel.TaskManagerStatSpeed = "--";
                _viewModel.TaskManagerStatCapacity = "--";
                _viewModel.TaskManagerStatStatus = "--";
                _viewModel.TaskManagerStatWriteSpeed = "--";
                _viewModel.TaskManagerStatReadSpeed = "--";
                break;
            case "memory":
                TaskManagerCategoryTitle.Text = "内存";
                _viewModel.TaskManagerStatLabel1 = "使用率";
                _viewModel.TaskManagerStatLabel2 = "已使用";
                _viewModel.TaskManagerStatLabel3 = "可用空间";
                _viewModel.TaskManagerStatLabel4 = "已提交";
                _viewModel.TaskManagerStatLabel5 = "已缓存";
                _viewModel.TaskManagerStatLabel6 = "内存速度";

                _viewModel.TaskManagerRightLabel1 = "内存速度:"; _viewModel.TaskManagerRightValue1 = "--";
                _viewModel.TaskManagerRightLabel2 = "插槽占比:"; _viewModel.TaskManagerRightValue2 = "--";
                _viewModel.TaskManagerRightLabel3 = "表形规格:"; _viewModel.TaskManagerRightValue3 = "--";

                _viewModel.CurrentCategoryCharts = _viewModel.ViewerMemoryCharts;
                _viewModel.SelectedCategoryChart = System.Linq.Enumerable.FirstOrDefault(_viewModel.ViewerMemoryCharts);
                _viewModel.TaskManagerStatUsage = currentDev is not null && !string.IsNullOrWhiteSpace(currentDev.MemoryText) && currentDev.MemoryText != "内存: --"
                    ? currentDev.MemoryText.Replace("内存 ", "")
                    : "--";
                _viewModel.TaskManagerStatSpeed = "--";
                _viewModel.TaskManagerStatCapacity = "--";
                _viewModel.TaskManagerStatStatus = "--";
                _viewModel.TaskManagerStatWriteSpeed = "--";
                _viewModel.TaskManagerStatReadSpeed = "--";
                break;
            case "disk":
                TaskManagerCategoryTitle.Text = "磁盘";
                _viewModel.TaskManagerStatLabel1 = "活动时间";
                _viewModel.TaskManagerStatLabel2 = "读取速度";
                _viewModel.TaskManagerStatLabel3 = "写入速度";
                _viewModel.TaskManagerStatLabel4 = "平均响应时间";
                _viewModel.TaskManagerStatLabel5 = "磁盘类型";
                _viewModel.TaskManagerStatLabel6 = "接口规格";

                _viewModel.TaskManagerRightLabel1 = "磁盘容量:"; _viewModel.TaskManagerRightValue1 = "--";
                _viewModel.TaskManagerRightLabel2 = "磁盘类型:"; _viewModel.TaskManagerRightValue2 = "--";
                _viewModel.TaskManagerRightLabel3 = "接口规格:"; _viewModel.TaskManagerRightValue3 = "--";

                _viewModel.CurrentCategoryCharts = _viewModel.ViewerDiskCharts;
                _viewModel.SelectedCategoryChart = System.Linq.Enumerable.FirstOrDefault(_viewModel.ViewerDiskCharts);
                _viewModel.TaskManagerStatUsage = currentDev is not null && !string.IsNullOrWhiteSpace(currentDev.DiskText)
                    ? currentDev.DiskText.Replace("磁盘 ", "")
                    : "--";
                _viewModel.TaskManagerStatSpeed = "--";
                _viewModel.TaskManagerStatCapacity = "--";
                _viewModel.TaskManagerStatStatus = "--";
                _viewModel.TaskManagerStatWriteSpeed = "--";
                _viewModel.TaskManagerStatReadSpeed = "--";
                break;
            case "network":
                TaskManagerCategoryTitle.Text = "网络";
                _viewModel.TaskManagerStatLabel1 = "发送速率";
                _viewModel.TaskManagerStatLabel2 = "接收速率";
                _viewModel.TaskManagerStatLabel3 = "链接速度";
                _viewModel.TaskManagerStatLabel4 = "适配器名称";
                _viewModel.TaskManagerStatLabel5 = "连接类型";
                _viewModel.TaskManagerStatLabel6 = "IPv4 地址";

                _viewModel.TaskManagerRightLabel1 = "IPv4 地址:"; _viewModel.TaskManagerRightValue1 = "--";
                _viewModel.TaskManagerRightLabel2 = "连接类型:"; _viewModel.TaskManagerRightValue2 = "--";
                _viewModel.TaskManagerRightLabel3 = "信号强度:"; _viewModel.TaskManagerRightValue3 = "--";

                _viewModel.CurrentCategoryCharts = _viewModel.ViewerNetworkCharts;
                _viewModel.SelectedCategoryChart = System.Linq.Enumerable.FirstOrDefault(_viewModel.ViewerNetworkCharts);
                _viewModel.TaskManagerStatUsage = "--";
                _viewModel.TaskManagerStatSpeed = "--";
                _viewModel.TaskManagerStatCapacity = "--";
                _viewModel.TaskManagerStatStatus = "--";
                _viewModel.TaskManagerStatWriteSpeed = "--";
                _viewModel.TaskManagerStatReadSpeed = "--";
                break;
            case "gpu":
                TaskManagerCategoryTitle.Text = "显卡";
                _viewModel.TaskManagerStatLabel1 = "利用率";
                _viewModel.TaskManagerStatLabel2 = "GPU 内存占用";
                _viewModel.TaskManagerStatLabel3 = "核心频率";
                _viewModel.TaskManagerStatLabel4 = "编码利用率";
                _viewModel.TaskManagerStatLabel5 = "解码利用率";
                _viewModel.TaskManagerStatLabel6 = "显卡温度";

                _viewModel.TaskManagerRightLabel1 = "GPU 内存总量:"; _viewModel.TaskManagerRightValue1 = "--";
                _viewModel.TaskManagerRightLabel2 = "驱动版本:"; _viewModel.TaskManagerRightValue2 = "--";
                _viewModel.TaskManagerRightLabel3 = "显卡温度:"; _viewModel.TaskManagerRightValue3 = "--";

                _viewModel.CurrentCategoryCharts = _viewModel.ViewerGpuCharts;
                _viewModel.SelectedCategoryChart = System.Linq.Enumerable.FirstOrDefault(_viewModel.ViewerGpuCharts);
                _viewModel.TaskManagerStatUsage = currentDev is not null && !string.IsNullOrWhiteSpace(currentDev.GpuText) && currentDev.GpuText != "GPU: --"
                    ? currentDev.GpuText.Replace("GPU ", "")
                    : "--";
                _viewModel.TaskManagerStatSpeed = "--";
                _viewModel.TaskManagerStatCapacity = "--";
                _viewModel.TaskManagerStatStatus = "--";
                _viewModel.TaskManagerStatWriteSpeed = "--";
                _viewModel.TaskManagerStatReadSpeed = "--";
                break;
            case "fan":
                TaskManagerCategoryTitle.Text = "风扇";
                _viewModel.TaskManagerStatLabel1 = "风扇转速";
                _viewModel.TaskManagerStatLabel2 = "控制模式";
                _viewModel.TaskManagerStatLabel3 = "目标温度";
                _viewModel.TaskManagerStatLabel4 = "最小 PWM";
                _viewModel.TaskManagerStatLabel5 = "最大 PWM";
                _viewModel.TaskManagerStatLabel6 = "通道状态";

                _viewModel.TaskManagerRightLabel1 = "控制模式:"; _viewModel.TaskManagerRightValue1 = "--";
                _viewModel.TaskManagerRightLabel2 = "通道数量:"; _viewModel.TaskManagerRightValue2 = "--";
                _viewModel.TaskManagerRightLabel3 = "目标温度:"; _viewModel.TaskManagerRightValue3 = "--";

                _viewModel.CurrentCategoryCharts = _viewModel.ViewerFanCharts;
                _viewModel.SelectedCategoryChart = System.Linq.Enumerable.FirstOrDefault(_viewModel.ViewerFanCharts);
                _viewModel.TaskManagerStatUsage = "--";
                _viewModel.TaskManagerStatSpeed = "--";
                _viewModel.TaskManagerStatCapacity = "--";
                _viewModel.TaskManagerStatStatus = "--";
                _viewModel.TaskManagerStatWriteSpeed = "--";
                _viewModel.TaskManagerStatReadSpeed = "--";
                break;
        }

        _viewModel.UpdateSubDeviceNamesDeduplicated();
        ReDrawCategoryCanvas(categoryTag);
    }

    private void SettingsPivot_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (SettingsPivot.SelectedItem is PivotItem item)
        {
            var tag = item.Tag as string;
            LocalControlPanel.Visibility = tag == "local" ? Visibility.Visible : Visibility.Collapsed;
            ServerConfigPanel.Visibility = tag == "server" ? Visibility.Visible : Visibility.Collapsed;
        }
    }

    private void NavigateToSettings_OnClick(object sender, RoutedEventArgs e)
    {
        var settingsItem = AppNavigation.FooterMenuItems.OfType<NavigationViewItem>().FirstOrDefault();
        if (settingsItem is not null)
        {
            AppNavigation.SelectedItem = settingsItem;
        }
    }

    private void FinishSettings_OnClick(object sender, RoutedEventArgs e)
    {
        AppNavigation.SelectedItem = null;
        SettingsPage.Visibility = Visibility.Collapsed;
        OverviewPage.Visibility = Visibility.Visible;
        _ = OpenHubAsync();
    }

    private void ViewerDeviceDetailsButton_OnClick(object sender, RoutedEventArgs e)
    {
        AppNavigation.SelectedItem = AppNavigation.MenuItems.OfType<NavigationViewItem>().FirstOrDefault();
    }

    private void ShowBackendUnavailable()
    {
        OverviewGrid.Visibility = Visibility.Collapsed;
        HubWebViewErrorState.Visibility = Visibility.Collapsed;
        HubWebViewHost.Visibility = Visibility.Collapsed;
        SetHubPageStatus("网页状态：等待中枢配置");
    }

    private void ShowHubPageError(string message)
    {
        OverviewGrid.Visibility = Visibility.Collapsed;
        HubWebViewHost.Visibility = Visibility.Collapsed;
        HubWebViewErrorState.Visibility = Visibility.Visible;
        HubPageErrorText.Text = message;
        SetHubPageStatus($"网页状态：无法加载（{message}）");
    }

    private void SetHubPageStatus(string status)
    {
        _hubPageStatus = status;
        if (HubPageStatusText is not null)
        {
            HubPageStatusText.Text = status;
        }
    }

    private void UpdateHubStatusText()
    {
        if (HubBackendStatusText is null)
        {
            return;
        }

        HubBackendStatusText.Text = $"中枢连接状态：{_viewModel.ConnectionText} · {_viewModel.TraySubmitStatusText}";
        HubPageStatusText.Text = _hubPageStatus;
    }

    private async Task OpenHubAsync()
    {
        if (string.IsNullOrWhiteSpace(_viewModel.ServerUrl) || string.IsNullOrWhiteSpace(_viewModel.Secret))
        {
            ShowBackendUnavailable();
            return;
        }

        SetHubPageStatus("网页状态：正在打开观澜…");

        if (!Uri.TryCreate(_viewModel.ServerUrl.TrimEnd('/'), UriKind.Absolute, out var serverUri) ||
            (serverUri.Scheme != Uri.UriSchemeHttp && serverUri.Scheme != Uri.UriSchemeHttps))
        {
            _viewModel.ViewerDataStatusText = "中枢地址无效，请在设置中填写 http:// 或 https:// 地址。";
            ShowBackendUnavailable();
            return;
        }

        try
        {
            // The hub page must remain usable even when the local collector backend
            // is stopped; the debounced settings writer will persist the same values.
            try
            {
                await _viewModel.SaveConfigurationAsync();
            }
            catch
            {
                // Opening the configured hub is independent from local telemetry.
            }
            var webViewDataFolder = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "DeviceStateConsole",
                "WebView2");
            Directory.CreateDirectory(webViewDataFolder);
            Environment.SetEnvironmentVariable(
                "WEBVIEW2_USER_DATA_FOLDER",
                webViewDataFolder,
                EnvironmentVariableTarget.Process);
            await HubWebView.EnsureCoreWebView2Async();
            if (HubWebView.CoreWebView2 is null)
            {
                throw new InvalidOperationException("WebView2 初始化失败，CoreWebView2 为空。请确认 WebView2 Runtime 可用且用户数据目录可写。");
            }
            HubWebViewHost.Visibility = Visibility.Visible;
            HubWebViewErrorState.Visibility = Visibility.Collapsed;
            _hubLoginStarted = false;
            SetHubPageStatus("网页状态：正在加载观澜…");
            // Navigate through the XAML control so the control owns initialization
            // and navigation consistently across Windows App SDK runtime versions.
            HubWebView.Source = serverUri;
        }
        catch (Exception ex)
        {
            ShowHubPageError($"无法打开观澜网页：{ex.Message}");
        }
    }

    private async void HubWebView_NavigationCompleted(WebView2 sender, CoreWebView2NavigationCompletedEventArgs args)
    {
        if (!args.IsSuccess)
        {
            ShowHubPageError($"观澜网页加载失败（错误码 {args.WebErrorStatus}）。请检查网页地址和网络连接。");
            return;
        }

        if (_hubLoginStarted || string.IsNullOrWhiteSpace(_viewModel.Secret))
        {
            SetHubPageStatus("网页状态：已加载");
            return;
        }

        _hubLoginStarted = true;
        SetHubPageStatus("网页状态：已打开，正在验证访问密钥…");
        var accessKey = JsonSerializer.Serialize(_viewModel.Secret);
        var script = $"(async()=>{{const response=await fetch('/api/auth/login', {{method:'POST', credentials:'include', headers:{{'Content-Type':'application/json'}}, body:JSON.stringify({{accessKey:{accessKey}}})}}); if(!response.ok) throw new Error('login:'+response.status); location.reload();}})().catch(()=>{{document.body.innerText='观澜网页登录失败，请返回设置检查访问密钥。';}});";
        try
        {
            await HubWebView.ExecuteScriptAsync(script);
        }
        catch
        {
            _hubLoginStarted = false;
        }
    }

    private void RetryHubPage_OnClick(object sender, RoutedEventArgs e)
    {
        _ = OpenHubAsync();
    }

    private void ReDrawCategoryCanvas(string categoryTag)
    {
        Canvas? targetCanvas = categoryTag switch
        {
            "cpu" => CpuOverviewChart,
            "memory" => MemoryOverviewChart,
            "disk" => DiskOverviewChart,
            "network" => NetworkOverviewChart,
            "gpu" => GpuOverviewChart,
            "fan" => FanOverviewChart,
            _ => null
        };

        if (targetCanvas is not null)
        {
            DrawTrend(targetCanvas);
        }
    }

    private void TrendCanvas_SizeChanged(object sender, SizeChangedEventArgs e)
    {
        if (sender is Canvas canvas)
        {
            DrawTrend(canvas);
        }
    }

    private void SubscribeTrend(ObservableCollection<TrendPointViewModel> points)
    {
        points.CollectionChanged += (_, _) => DispatcherQueue.TryEnqueue(() =>
        {
            DrawTrend(CpuOverviewChart);
            DrawTrend(MemoryOverviewChart);
            DrawTrend(DiskOverviewChart);
            DrawTrend(GpuOverviewChart);
            DrawTrend(NetworkOverviewChart);
            DrawTrend(FanOverviewChart);
        });
    }

    private void DrawTrend(Canvas canvas)
    {
        canvas.Children.Clear();
        var padding = 2.0;
        var width = Math.Max(1, canvas.ActualWidth - padding * 2);
        var height = Math.Max(1, canvas.ActualHeight - padding * 2);

        // 1. 绘制任务管理器风格暗灰背景网格
        var gridBrush = new SolidColorBrush(Color.FromArgb(30, 255, 255, 255));
        for (int i = 1; i < 4; i++)
        {
            var y = padding + (height * i / 4);
            var hLine = new Microsoft.UI.Xaml.Shapes.Line { X1 = padding, Y1 = y, X2 = padding + width, Y2 = y, Stroke = gridBrush, StrokeThickness = 1 };
            canvas.Children.Add(hLine);
        }
        for (int i = 1; i < 6; i++)
        {
            var x = padding + (width * i / 6);
            var vLine = new Microsoft.UI.Xaml.Shapes.Line { X1 = x, Y1 = padding, X2 = x, Y2 = padding + height, Stroke = gridBrush, StrokeThickness = 1 };
            canvas.Children.Add(vLine);
        }

        var tag = canvas.Tag as string;
        var points = tag switch
        {
            "cpu" => _viewModel.ViewerCpuTrendPoints,
            "memory" => _viewModel.ViewerMemoryTrendPoints,
            "disk" => _viewModel.ViewerDiskTrendPoints,
            "gpu" => _viewModel.ViewerGpuTrendPoints,
            "network" => _viewModel.ViewerNetworkTrendPoints,
            "fan" => _viewModel.ViewerFanTrendPoints,
            _ => null
        };

        if (points is null || points.Count == 0)
        {
            // 无数据点时，绘制一条淡灰基线
            var baseLine = new Microsoft.UI.Xaml.Shapes.Line
            {
                X1 = padding,
                Y1 = padding + height,
                X2 = padding + width,
                Y2 = padding + height,
                Stroke = new SolidColorBrush(Color.FromArgb(80, 255, 255, 255)),
                StrokeThickness = 1.5
            };
            canvas.Children.Add(baseLine);
            return;
        }

        // 2. 有点时绘制高级渐变与波形折线
        var line = new Polyline
        {
            Stroke = new SolidColorBrush((Color)Application.Current.Resources["SystemAccentColor"]),
            StrokeThickness = 2,
            StrokeLineJoin = PenLineJoin.Round
        };

        var accentColor = (Color)Application.Current.Resources["SystemAccentColor"];
        var fillColor = Color.FromArgb(40, accentColor.R, accentColor.G, accentColor.B);

        var polygon = new Microsoft.UI.Xaml.Shapes.Polygon
        {
            Fill = new SolidColorBrush(fillColor)
        };
        polygon.Points.Add(new Point(padding, padding + height));

        for (var index = 0; index < points.Count; index++)
        {
            var x = padding + (points.Count == 1 ? width : width * index / (points.Count - 1));
            var y = padding + height * (1 - Math.Clamp(points[index].Value, 0, 100) / 100);
            var pt = new Point(x, y);
            line.Points.Add(pt);
            polygon.Points.Add(pt);
        }
        polygon.Points.Add(new Point(padding + width, padding + height));

        canvas.Children.Add(polygon);
        canvas.Children.Add(line);
    }

    private void SecretBox_OnPasswordChanged(object sender, RoutedEventArgs e)
    {
        _viewModel.Secret = SecretBox.Password;
    }

    private async void CategoryMetricConfigButton_OnClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: string target })
        {
            await ShowMetricConfigDialogAsync(target, null);
        }
    }

    private async void InstanceMetricEditorButton_OnClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button { DataContext: ProbeInstanceItemViewModel item })
        {
            await ShowMetricConfigDialogAsync(item.Target, item);
        }
    }

    private async Task ShowMetricConfigDialogAsync(string target, ProbeInstanceItemViewModel? instance)
    {
        if (_metricConfigDialogOpen || RootLayout.XamlRoot is null)
        {
            return;
        }

        _metricConfigDialogOpen = true;
        try
        {
            var model = _viewModel.CreateMetricConfigDialog(target, instance);
            var dialog = new MetricConfigDialog(model)
            {
                XamlRoot = RootLayout.XamlRoot
            };
            var result = await dialog.ShowAsync();
            if (result == ContentDialogResult.Primary)
            {
                _viewModel.ApplyMetricConfigDialog(
                    target,
                    instance?.Id,
                    model.Options.Where(option => option.IsEnabled).Select(option => option.Key));
            }
        }
        finally
        {
            _metricConfigDialogOpen = false;
        }
    }

    private void RootLayout_SizeChanged(object sender, SizeChangedEventArgs e)
    {
        ApplyResponsiveLayout(e.NewSize.Width < 900);
    }

    private void ApplyResponsiveLayout(bool isCompact)
    {
        _isCompactLayout = isCompact;
        AppNavigation.IsPaneOpen = !isCompact;
    }

    private void EnsureAppWindow()
    {
        if (_appWindowInitialized) return;
        var hwnd = WindowNative.GetWindowHandle(this);
        var windowId = Microsoft.UI.Win32Interop.GetWindowIdFromWindow(hwnd);
        _appWindow = Microsoft.UI.Windowing.AppWindow.GetFromWindowId(windowId);
        _appWindow.Closing += AppWindow_Closing;
        ApplyTitleBarTheme();
        _appWindowInitialized = true;
    }

    private void ApplySystemBackdrop()
    {
        if (Microsoft.UI.Composition.SystemBackdrops.MicaController.IsSupported())
        {
            SystemBackdrop = new MicaBackdrop();
        }
    }

    private void ApplyTitleBarTheme()
    {
        if (_appWindow is null) return;
        var titleBar = _appWindow.TitleBar;
        titleBar.ButtonBackgroundColor = Colors.Transparent;
        titleBar.ButtonInactiveBackgroundColor = Colors.Transparent;
        titleBar.ButtonHoverBackgroundColor = Color.FromArgb(30, 255, 255, 255);
        titleBar.ButtonPressedBackgroundColor = Color.FromArgb(60, 255, 255, 255);
        titleBar.ButtonForegroundColor = Colors.White;
        titleBar.ButtonHoverForegroundColor = Colors.White;
        titleBar.ButtonInactiveForegroundColor = Colors.Gray;
    }

    private void AppWindow_Closing(Microsoft.UI.Windowing.AppWindow sender, Microsoft.UI.Windowing.AppWindowClosingEventArgs args)
    {
        if (_allowClose) return;
        args.Cancel = true;
        HideWindow();
    }

    private const int SwHide = 0;
    private const int SwRestore = 9;

    [DllImport("user32.dll", EntryPoint = "ShowWindow")]
    private static extern bool ShowWindowNative(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool BringWindowToTop(IntPtr hWnd);
}
