using DeviceStateConsoleAgent.WinUI.Common;
using DeviceStateConsoleAgent.WinUI.ViewModels;
using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using System.Runtime.InteropServices;
using System.Collections.ObjectModel;
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
    private string _currentSelectedCategory = "cpu";

    public MainWindow(MainViewModel viewModel)
    {
        _viewModel = viewModel;
        InitializeComponent();
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
            SyncDeviceMenuItems();
            AppNavigation.SelectedItem = AppNavigation.MenuItems.OfType<NavigationViewItem>().FirstOrDefault();
            if (TaskManagerCategoryListView is not null && TaskManagerCategoryListView.SelectedIndex < 0)
            {
                TaskManagerCategoryListView.SelectedIndex = 0;
            }
        };

        RootLayout.ActualThemeChanged += (_, _) => ApplyTitleBarTheme();

        _viewModel.FilteredViewerDevices.CollectionChanged += (_, _) => DispatcherQueue.TryEnqueue(SyncDeviceMenuItems);

        _viewModel.PropertyChanged += (_, args) =>
        {
            if (args.PropertyName == nameof(MainViewModel.Secret) && SecretBox.Password != _viewModel.Secret)
            {
                SecretBox.Password = _viewModel.Secret;
            }

            if (args.PropertyName == nameof(MainViewModel.ViewerSessionReady))
            {
                DispatcherQueue.TryEnqueue(UpdateMonitorAvailability);
            }

            if (args.PropertyName == nameof(MainViewModel.SelectedViewerDeviceId))
            {
                DispatcherQueue.TryEnqueue(() => SwitchCategory(_currentSelectedCategory));
            }
        };

        SecretBox.Password = _viewModel.Secret;
        UpdateMonitorAvailability();
    }

    public async Task EnsureInitializedAsync()
    {
        if (_initialized) return;
        _initialized = true;
        EnsureAppWindow();
        await _viewModel.InitializeAsync();
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
        var existingDynamicItems = AppNavigation.MenuItems
            .OfType<NavigationViewItem>()
            .Where(item => (item.Tag as string)?.StartsWith("device_", StringComparison.Ordinal) == true)
            .ToList();

        foreach (var item in existingDynamicItems)
        {
            AppNavigation.MenuItems.Remove(item);
        }

        foreach (var device in _viewModel.FilteredViewerDevices)
        {
            var item = new NavigationViewItem
            {
                Content = device.Hostname,
                Tag = $"device_{device.DeviceId}",
                Icon = new FontIcon { Glyph = "\uE7F8" }
            };
            AppNavigation.MenuItems.Add(item);
        }
    }

    private void NavigationView_SelectionChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
    {
        if (args.SelectedItem is not NavigationViewItem selectedItem) return;
        var tag = selectedItem.Tag as string ?? "";

        OverviewPage.Visibility = Visibility.Collapsed;
        TaskManagerPage.Visibility = Visibility.Collapsed;
        SettingsPage.Visibility = Visibility.Collapsed;

        if (tag == "overview")
        {
            OverviewPage.Visibility = Visibility.Visible;
        }
        else if (tag == "settings")
        {
            SettingsPage.Visibility = Visibility.Visible;
        }
        else if (tag.StartsWith("device_", StringComparison.Ordinal))
        {
            var deviceId = tag.Substring("device_".Length);
            _viewModel.SelectedViewerDeviceId = deviceId;
            TaskManagerPage.Visibility = Visibility.Visible;
            SwitchCategory(_currentSelectedCategory);
        }
    }

    private void TaskManagerCategoryListView_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (TaskManagerCategoryListView?.SelectedItem is ListViewItem selectedItem)
        {
            var tag = selectedItem.Tag as string ?? "cpu";
            SwitchCategory(tag);
        }
    }

    private void SwitchCategory(string categoryTag)
    {
        if (TaskManagerCategoryTitle is null || _viewModel is null) return;

        _currentSelectedCategory = categoryTag;
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

                _viewModel.TaskManagerRightLabel1 = "基准速度:"; _viewModel.TaskManagerRightValue1 = "2.40 GHz";
                _viewModel.TaskManagerRightLabel2 = "物理内核:"; _viewModel.TaskManagerRightValue2 = "8";
                _viewModel.TaskManagerRightLabel3 = "逻辑处理器:"; _viewModel.TaskManagerRightValue3 = "16";
                _viewModel.TaskManagerRightLabel4 = "最后采集:"; _viewModel.TaskManagerRightValue4 = "刚刚";

                _viewModel.CurrentCategoryCharts = _viewModel.ViewerCpuCharts;
                _viewModel.SelectedCategoryChart = System.Linq.Enumerable.FirstOrDefault(_viewModel.ViewerCpuCharts);
                _viewModel.TaskManagerStatUsage = currentDev is not null && !string.IsNullOrWhiteSpace(currentDev.CpuText) && currentDev.CpuText != "CPU: --"
                    ? currentDev.CpuText.Replace("CPU ", "")
                    : "12.5%";
                _viewModel.TaskManagerStatSpeed = "3.80 GHz";
                _viewModel.TaskManagerStatCapacity = "8 / 16";
                _viewModel.TaskManagerStatStatus = "182";
                _viewModel.TaskManagerStatWriteSpeed = "2410";
                _viewModel.TaskManagerStatReadSpeed = "78210";
                break;
            case "memory":
                TaskManagerCategoryTitle.Text = "内存";
                _viewModel.TaskManagerStatLabel1 = "使用率";
                _viewModel.TaskManagerStatLabel2 = "已使用";
                _viewModel.TaskManagerStatLabel3 = "可用空间";
                _viewModel.TaskManagerStatLabel4 = "已提交";
                _viewModel.TaskManagerStatLabel5 = "已缓存";
                _viewModel.TaskManagerStatLabel6 = "内存速度";

                _viewModel.TaskManagerRightLabel1 = "内存速度:"; _viewModel.TaskManagerRightValue1 = "4800 MHz";
                _viewModel.TaskManagerRightLabel2 = "插槽占比:"; _viewModel.TaskManagerRightValue2 = "2/4";
                _viewModel.TaskManagerRightLabel3 = "表形规格:"; _viewModel.TaskManagerRightValue3 = "SO-DIMM";
                _viewModel.TaskManagerRightLabel4 = "最后采集:"; _viewModel.TaskManagerRightValue4 = "刚刚";

                _viewModel.CurrentCategoryCharts = _viewModel.ViewerMemoryCharts;
                _viewModel.SelectedCategoryChart = System.Linq.Enumerable.FirstOrDefault(_viewModel.ViewerMemoryCharts);
                _viewModel.TaskManagerStatUsage = currentDev is not null && !string.IsNullOrWhiteSpace(currentDev.MemoryText) && currentDev.MemoryText != "内存: --"
                    ? currentDev.MemoryText.Replace("内存 ", "")
                    : "48.2%";
                _viewModel.TaskManagerStatSpeed = "7.7 GB";
                _viewModel.TaskManagerStatCapacity = "8.3 GB";
                _viewModel.TaskManagerStatStatus = "9.2 / 18.0 GB";
                _viewModel.TaskManagerStatWriteSpeed = "4.1 GB";
                _viewModel.TaskManagerStatReadSpeed = "4800 MHz";
                break;
            case "disk":
                TaskManagerCategoryTitle.Text = "磁盘";
                _viewModel.TaskManagerStatLabel1 = "活动时间";
                _viewModel.TaskManagerStatLabel2 = "读取速度";
                _viewModel.TaskManagerStatLabel3 = "写入速度";
                _viewModel.TaskManagerStatLabel4 = "平均响应时间";
                _viewModel.TaskManagerStatLabel5 = "磁盘类型";
                _viewModel.TaskManagerStatLabel6 = "接口规格";

                _viewModel.TaskManagerRightLabel1 = "磁盘容量:"; _viewModel.TaskManagerRightValue1 = "1000 GB";
                _viewModel.TaskManagerRightLabel2 = "磁盘类型:"; _viewModel.TaskManagerRightValue2 = "NVMe SSD";
                _viewModel.TaskManagerRightLabel3 = "接口规格:"; _viewModel.TaskManagerRightValue3 = "PCIe 4.0 x4";
                _viewModel.TaskManagerRightLabel4 = "最后采集:"; _viewModel.TaskManagerRightValue4 = "刚刚";

                _viewModel.CurrentCategoryCharts = _viewModel.ViewerDiskCharts;
                _viewModel.SelectedCategoryChart = System.Linq.Enumerable.FirstOrDefault(_viewModel.ViewerDiskCharts);
                _viewModel.TaskManagerStatUsage = currentDev is not null && !string.IsNullOrWhiteSpace(currentDev.DiskText)
                    ? currentDev.DiskText.Replace("磁盘 ", "")
                    : "12%";
                _viewModel.TaskManagerStatSpeed = "1.2 MB/s";
                _viewModel.TaskManagerStatCapacity = "850 KB/s";
                _viewModel.TaskManagerStatStatus = "1.2 ms";
                _viewModel.TaskManagerStatWriteSpeed = "NVMe SSD";
                _viewModel.TaskManagerStatReadSpeed = "PCIe 4.0 x4";
                break;
            case "network":
                TaskManagerCategoryTitle.Text = "网络";
                _viewModel.TaskManagerStatLabel1 = "发送速率";
                _viewModel.TaskManagerStatLabel2 = "接收速率";
                _viewModel.TaskManagerStatLabel3 = "链接速度";
                _viewModel.TaskManagerStatLabel4 = "适配器名称";
                _viewModel.TaskManagerStatLabel5 = "连接类型";
                _viewModel.TaskManagerStatLabel6 = "IPv4 地址";

                _viewModel.TaskManagerRightLabel1 = "IPv4 地址:"; _viewModel.TaskManagerRightValue1 = "192.168.1.102";
                _viewModel.TaskManagerRightLabel2 = "连接类型:"; _viewModel.TaskManagerRightValue2 = "Wi-Fi 6E (5G)";
                _viewModel.TaskManagerRightLabel3 = "信号强度:"; _viewModel.TaskManagerRightValue3 = "100%";
                _viewModel.TaskManagerRightLabel4 = "最后采集:"; _viewModel.TaskManagerRightValue4 = "刚刚";

                _viewModel.CurrentCategoryCharts = _viewModel.ViewerNetworkCharts;
                _viewModel.SelectedCategoryChart = System.Linq.Enumerable.FirstOrDefault(_viewModel.ViewerNetworkCharts);
                _viewModel.TaskManagerStatUsage = "12.4 KB/s";
                _viewModel.TaskManagerStatSpeed = "158.2 KB/s";
                _viewModel.TaskManagerStatCapacity = "1.2 Gbps";
                _viewModel.TaskManagerStatStatus = "Wi-Fi 6E (802.11ax)";
                _viewModel.TaskManagerStatWriteSpeed = "无线网络 (5 GHz)";
                _viewModel.TaskManagerStatReadSpeed = "192.168.1.102";
                break;
            case "gpu":
                TaskManagerCategoryTitle.Text = "显卡";
                _viewModel.TaskManagerStatLabel1 = "利用率";
                _viewModel.TaskManagerStatLabel2 = "显存占用";
                _viewModel.TaskManagerStatLabel3 = "核心频率";
                _viewModel.TaskManagerStatLabel4 = "编码利用率";
                _viewModel.TaskManagerStatLabel5 = "解码利用率";
                _viewModel.TaskManagerStatLabel6 = "显卡温度";

                _viewModel.TaskManagerRightLabel1 = "显存总量:"; _viewModel.TaskManagerRightValue1 = "8.0 GB";
                _viewModel.TaskManagerRightLabel2 = "驱动版本:"; _viewModel.TaskManagerRightValue2 = "551.23";
                _viewModel.TaskManagerRightLabel3 = "显卡温度:"; _viewModel.TaskManagerRightValue3 = "48 °C";
                _viewModel.TaskManagerRightLabel4 = "最后采集:"; _viewModel.TaskManagerRightValue4 = "刚刚";

                _viewModel.CurrentCategoryCharts = _viewModel.ViewerGpuCharts;
                _viewModel.SelectedCategoryChart = System.Linq.Enumerable.FirstOrDefault(_viewModel.ViewerGpuCharts);
                _viewModel.TaskManagerStatUsage = currentDev is not null && !string.IsNullOrWhiteSpace(currentDev.GpuText) && currentDev.GpuText != "GPU: --"
                    ? currentDev.GpuText.Replace("GPU ", "")
                    : "5.0%";
                _viewModel.TaskManagerStatSpeed = "2.1 / 8.0 GB";
                _viewModel.TaskManagerStatCapacity = "1950 MHz";
                _viewModel.TaskManagerStatStatus = "0.0%";
                _viewModel.TaskManagerStatWriteSpeed = "0.0%";
                _viewModel.TaskManagerStatReadSpeed = "48 °C";
                break;
            case "fan":
                TaskManagerCategoryTitle.Text = "风扇";
                _viewModel.TaskManagerStatLabel1 = "风扇转速";
                _viewModel.TaskManagerStatLabel2 = "控制模式";
                _viewModel.TaskManagerStatLabel3 = "目标温度";
                _viewModel.TaskManagerStatLabel4 = "最小 PWM";
                _viewModel.TaskManagerStatLabel5 = "最大 PWM";
                _viewModel.TaskManagerStatLabel6 = "通道状态";

                _viewModel.TaskManagerRightLabel1 = "控制模式:"; _viewModel.TaskManagerRightValue1 = "PWM 智能控速";
                _viewModel.TaskManagerRightLabel2 = "通道数量:"; _viewModel.TaskManagerRightValue2 = "1 通道";
                _viewModel.TaskManagerRightLabel3 = "目标温度:"; _viewModel.TaskManagerRightValue3 = "55 °C";
                _viewModel.TaskManagerRightLabel4 = "最后采集:"; _viewModel.TaskManagerRightValue4 = "刚刚";

                _viewModel.CurrentCategoryCharts = _viewModel.ViewerFanCharts;
                _viewModel.SelectedCategoryChart = System.Linq.Enumerable.FirstOrDefault(_viewModel.ViewerFanCharts);
                _viewModel.TaskManagerStatUsage = "1850 RPM";
                _viewModel.TaskManagerStatSpeed = "PWM 智能调速";
                _viewModel.TaskManagerStatCapacity = "55 °C";
                _viewModel.TaskManagerStatStatus = "30%";
                _viewModel.TaskManagerStatWriteSpeed = "100%";
                _viewModel.TaskManagerStatReadSpeed = "1 通道全速运转";
                break;
        }

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

    private void ViewerDeviceDetailsButton_OnClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button { DataContext: ViewerDeviceItemViewModel device })
        {
            _viewModel.SelectedViewerDeviceId = device.DeviceId;

            var tag = $"device_{device.DeviceId}";
            var deviceItem = AppNavigation.MenuItems.OfType<NavigationViewItem>().FirstOrDefault(i => (i.Tag as string) == tag);
            if (deviceItem is not null)
            {
                AppNavigation.SelectedItem = deviceItem;
            }
            else
            {
                TaskManagerPage.Visibility = Visibility.Visible;
                OverviewPage.Visibility = Visibility.Collapsed;
                SettingsPage.Visibility = Visibility.Collapsed;
                SwitchCategory("cpu");
            }
        }
    }

    private void UpdateMonitorAvailability()
    {
        var isReady = _viewModel.ViewerSessionReady;
        OverviewUnavailableState.Visibility = isReady ? Visibility.Collapsed : Visibility.Visible;
        OverviewGrid.Visibility = isReady ? Visibility.Visible : Visibility.Collapsed;
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

    private void NavigationView_BackRequested(NavigationView sender, NavigationViewBackRequestedEventArgs args)
    {
    }

    private void MetricWindow_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
    }

    private void InstanceMetricEditorButton_OnClick(object sender, RoutedEventArgs e)
    {
    }

    private void ClearInstanceMetricEditorButton_OnClick(object sender, RoutedEventArgs e)
    {
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
