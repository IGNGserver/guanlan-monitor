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
                _viewModel.CurrentCategoryCharts = _viewModel.ViewerCpuCharts;
                _viewModel.TaskManagerStatUsage = currentDev is not null && !string.IsNullOrWhiteSpace(currentDev.CpuText) && currentDev.CpuText != "CPU: --"
                    ? currentDev.CpuText.Replace("CPU ", "")
                    : "12.5%";
                _viewModel.TaskManagerStatSpeed = "3.80 GHz";
                _viewModel.TaskManagerStatCapacity = "全内核活跃";
                break;
            case "memory":
                TaskManagerCategoryTitle.Text = "内存";
                _viewModel.CurrentCategoryCharts = _viewModel.ViewerMemoryCharts;
                _viewModel.TaskManagerStatUsage = currentDev is not null && !string.IsNullOrWhiteSpace(currentDev.MemoryText) && currentDev.MemoryText != "内存: --"
                    ? currentDev.MemoryText.Replace("内存 ", "")
                    : "48.2%";
                _viewModel.TaskManagerStatSpeed = "双通道 / 高频";
                _viewModel.TaskManagerStatCapacity = currentDev?.MemoryText ?? "16.0 GB";
                break;
            case "disk":
                TaskManagerCategoryTitle.Text = "磁盘";
                _viewModel.CurrentCategoryCharts = _viewModel.ViewerDiskCharts;
                _viewModel.TaskManagerStatUsage = currentDev is not null && !string.IsNullOrWhiteSpace(currentDev.DiskText)
                    ? currentDev.DiskText.Replace("磁盘 ", "")
                    : "35.0%";
                _viewModel.TaskManagerStatSpeed = "高读写速率";
                _viewModel.TaskManagerStatCapacity = currentDev?.DiskText ?? "1000 GB";
                break;
            case "network":
                TaskManagerCategoryTitle.Text = "网络";
                _viewModel.CurrentCategoryCharts = _viewModel.ViewerNetworkCharts;
                _viewModel.TaskManagerStatUsage = "发送 / 接收活动中";
                _viewModel.TaskManagerStatSpeed = "以太网 / Wi-Fi";
                _viewModel.TaskManagerStatCapacity = "全双工传输";
                break;
            case "gpu":
                TaskManagerCategoryTitle.Text = "显卡";
                _viewModel.CurrentCategoryCharts = _viewModel.ViewerGpuCharts;
                _viewModel.TaskManagerStatUsage = currentDev is not null && !string.IsNullOrWhiteSpace(currentDev.GpuText) && currentDev.GpuText != "GPU: --"
                    ? currentDev.GpuText.Replace("GPU ", "")
                    : "5.0%";
                _viewModel.TaskManagerStatSpeed = "Core Clock";
                _viewModel.TaskManagerStatCapacity = currentDev?.GpuText ?? "独立显卡";
                break;
            case "fan":
                TaskManagerCategoryTitle.Text = "风扇";
                _viewModel.CurrentCategoryCharts = _viewModel.ViewerFanCharts;
                _viewModel.TaskManagerStatUsage = "自动控速";
                _viewModel.TaskManagerStatSpeed = "PWM 自动控速";
                _viewModel.TaskManagerStatCapacity = "正常运转";
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
