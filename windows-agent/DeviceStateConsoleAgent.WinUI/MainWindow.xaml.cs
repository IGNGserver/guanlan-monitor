using DeviceStateConsoleAgent.WinUI.Common;
using DeviceStateConsoleAgent.WinUI.ViewModels;
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
    private bool _hasAppliedResponsiveLayout;

    public MainWindow(MainViewModel viewModel)
    {
        _viewModel = viewModel;
        InitializeComponent();
        ApplySystemBackdrop();
        RootLayout.DataContext = _viewModel;
        SubscribeTrend(_viewModel.ViewerCpuTrendPoints);
        SubscribeTrend(_viewModel.ViewerMemoryTrendPoints);
        SubscribeTrend(_viewModel.ViewerDiskTrendPoints);
        SubscribeTrend(_viewModel.ViewerGpuTrendPoints);
        SubscribeTrend(_viewModel.ViewerNetworkTrendPoints);
        SubscribeTrend(_viewModel.ViewerFanTrendPoints);
        AppNavigation.Loaded += (_, _) =>
        {
            AppNavigation.PaneDisplayMode = NavigationViewPaneDisplayMode.Left;
            AppNavigation.IsPaneOpen = true;
            AppNavigation.SelectedItem = AppNavigation.MenuItems.OfType<NavigationViewItem>().FirstOrDefault();
        };
        RootLayout.ActualThemeChanged += (_, _) => ApplyTitleBarTheme();
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

            if (args.PropertyName?.StartsWith("HasViewer", StringComparison.Ordinal) == true)
            {
                DispatcherQueue.TryEnqueue(UpdateMetricCategoryVisibility);
            }
        };
        SecretBox.Password = _viewModel.Secret;
        ViewerAccessBox.Password = _viewModel.ViewerAccessKey;
        ServerViewerAccessBox.Password = _viewModel.ViewerAccessKey;
        UpdateMonitorAvailability();
    }

    public async Task EnsureInitializedAsync()
    {
        if (_initialized)
        {
            return;
        }

        _initialized = true;
        EnsureAppWindow();
        await _viewModel.InitializeAsync();
        DispatcherQueue.TryEnqueue(() => ApplyResponsiveLayout(RootLayout.ActualWidth < 900));
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
        DispatcherQueue.TryEnqueue(() =>
        {
            if (RootLayout.ActualWidth >= 900)
            {
                AppNavigation.PaneDisplayMode = NavigationViewPaneDisplayMode.Left;
                AppNavigation.IsPaneOpen = true;
            }
        });
    }

    public void HideWindow()
    {
        EnsureAppWindow();
        var hwnd = WindowNative.GetWindowHandle(this);
        ShowWindowNative(hwnd, SwHide);
    }

    public void PrepareForExit()
    {
        _allowClose = true;
    }

    private void AppWindow_Closing(Microsoft.UI.Windowing.AppWindow sender, Microsoft.UI.Windowing.AppWindowClosingEventArgs args)
    {
        if (_allowClose)
        {
            _viewModel.Shutdown();
            return;
        }

        args.Cancel = true;
        HideWindow();
    }

    private void EnsureAppWindow()
    {
        if (_appWindowInitialized)
        {
            return;
        }

        _appWindow = WindowInterop.GetAppWindow(this);
        ExtendsContentIntoTitleBar = true;
        var iconPath = Path.Combine(AppContext.BaseDirectory, "app-icon.ico");
        if (File.Exists(iconPath))
        {
            _appWindow.SetIcon(iconPath);
        }
        ApplyTitleBarTheme();
        _appWindow.Closing += AppWindow_Closing;
        _appWindowInitialized = true;
    }

    private void ApplySystemBackdrop()
    {
        // Windows 11 supports Mica; Windows 10 gets the familiar Acrylic surface.
        var isWindows11 = Environment.OSVersion.Version.Build >= 22000;
        SystemBackdrop = isWindows11 ? new MicaBackdrop() : new DesktopAcrylicBackdrop();
        if (!isWindows11)
        {
            // Match the denser, square-cornered Windows 10 shell and controls.
            Application.Current.Resources["ControlCornerRadius"] = new CornerRadius(0);
            Application.Current.Resources["OverlayCornerRadius"] = new CornerRadius(0);
            Application.Current.Resources["NavigationViewItemCornerRadius"] = new CornerRadius(0);
        }
        var transparent = Color.FromArgb(0, 0, 0, 0);
        RootLayout.Background = new SolidColorBrush(transparent);
        AppNavigation.Background = new SolidColorBrush(transparent);
    }

    private void ApplyTitleBarTheme()
    {
        if (_appWindow is null)
        {
            return;
        }

        var isDark = RootLayout.ActualTheme == ElementTheme.Dark;
        var background = (RootLayout.Background as SolidColorBrush)?.Color
            ?? (isDark ? Color.FromArgb(255, 32, 32, 32) : Color.FromArgb(255, 243, 243, 243));
        var foreground = isDark ? Color.FromArgb(255, 255, 255, 255) : Color.FromArgb(255, 0, 0, 0);
        var inactiveForeground = isDark ? Color.FromArgb(255, 190, 190, 190) : Color.FromArgb(255, 100, 100, 100);
        var buttonHover = isDark ? Color.FromArgb(255, 55, 55, 55) : Color.FromArgb(255, 230, 230, 230);

        var titleBar = _appWindow.TitleBar;
        titleBar.BackgroundColor = background;
        titleBar.InactiveBackgroundColor = background;
        titleBar.ForegroundColor = foreground;
        titleBar.InactiveForegroundColor = inactiveForeground;
        titleBar.ButtonBackgroundColor = background;
        titleBar.ButtonInactiveBackgroundColor = background;
        titleBar.ButtonForegroundColor = foreground;
        titleBar.ButtonInactiveForegroundColor = inactiveForeground;
        titleBar.ButtonHoverBackgroundColor = buttonHover;
        titleBar.ButtonPressedBackgroundColor = buttonHover;
    }

    private void RootLayout_SizeChanged(object sender, SizeChangedEventArgs e)
    {
        var isCompact = e.NewSize.Width < 900;
        if (!_hasAppliedResponsiveLayout || isCompact != _isCompactLayout)
        {
            _isCompactLayout = isCompact;
            _hasAppliedResponsiveLayout = true;
            ApplyResponsiveLayout(isCompact);
        }
    }

    private void SubscribeTrend(ObservableCollection<TrendPointViewModel> trend)
    {
        trend.CollectionChanged += (_, _) => DispatcherQueue.TryEnqueue(RedrawAllTrends);
    }

    private void TrendCanvas_SizeChanged(object sender, SizeChangedEventArgs e)
    {
        if (sender is Canvas canvas)
        {
            DrawTrend(canvas);
        }
    }

    private void RedrawAllTrends()
    {
        foreach (var canvas in new[]
        {
            CpuOverviewChart, MemoryOverviewChart, DiskOverviewChart, GpuOverviewChart, NetworkOverviewChart, FanOverviewChart
        })
        {
            DrawTrend(canvas);
        }
    }

    private void DrawTrend(Canvas canvas)
    {
        if (canvas.ActualWidth < 12 || canvas.ActualHeight < 12)
        {
            return;
        }

        var points = canvas.Tag?.ToString() switch
        {
            "cpu" => _viewModel.ViewerCpuTrendPoints,
            "memory" => _viewModel.ViewerMemoryTrendPoints,
            "disk" => _viewModel.ViewerDiskTrendPoints,
            "gpu" => _viewModel.ViewerGpuTrendPoints,
            "network" => _viewModel.ViewerNetworkTrendPoints,
            "fan" => _viewModel.ViewerFanTrendPoints,
            _ => null
        };

        canvas.Children.Clear();
        if (points is null || points.Count == 0)
        {
            return;
        }

        const double padding = 4;
        var width = Math.Max(1, canvas.ActualWidth - padding * 2);
        var height = Math.Max(1, canvas.ActualHeight - padding * 2);
        var line = new Polyline
        {
            Stroke = new SolidColorBrush(Color.FromArgb(255, 74, 190, 238)),
            StrokeThickness = 2,
            StrokeLineJoin = PenLineJoin.Round
        };

        for (var index = 0; index < points.Count; index++)
        {
            var x = padding + (points.Count == 1 ? width : width * index / (points.Count - 1));
            var y = padding + height * (1 - Math.Clamp(points[index].Value, 0, 100) / 100);
            line.Points.Add(new Point(x, y));
        }

        canvas.Children.Add(line);
    }

    private void ApplyResponsiveLayout(bool isCompact)
    {
        AppNavigation.IsPaneOpen = !isCompact;
        ContentLayout.Padding = isCompact ? new Thickness(16, 16, 16, 16) : new Thickness(28, 24, 28, 24);

        SetColumns(MonitorDetailMetricsGrid, isCompact, 2);
        SetColumns(MonitorTrendGrid, isCompact, 3);
        SetColumns(MonitorStatusGrid, isCompact, 2);
        SetColumns(MonitorRemoteGrid, isCompact, 3);
        SetColumns(LocalProbeGrid, isCompact, 2);
        SetColumns(LocalSummaryGrid, isCompact, 2);
        SetColumns(LocalMetricCardsGrid, isCompact, 2);
        SetColumns(LocalHealthGrid, isCompact, 2);
        SetColumns(ServerButtonsGrid, isCompact, 2);

        if (MonitorWorkspace is not null)
        {
            MonitorWorkspace.ColumnDefinitions[0].Width = isCompact
                ? new GridLength(1, GridUnitType.Star)
                : new GridLength(240);
        }
    }

    private void UpdateMonitorAvailability()
    {
        var isReady = _viewModel.ViewerSessionReady;
        MonitorWorkspace.Visibility = isReady ? Visibility.Visible : Visibility.Collapsed;
        MonitorUnavailableState.Visibility = isReady ? Visibility.Collapsed : Visibility.Visible;
        UpdateMetricCategoryVisibility();
    }

    private void UpdateMetricCategoryVisibility()
    {
        var expanders = MetricCategoryList.Children.OfType<Expander>().ToArray();
        if (expanders.Length < 6)
        {
            return;
        }

        var visibility = new[]
        {
            _viewModel.HasViewerCpuCharts,
            _viewModel.HasViewerMemoryCharts,
            _viewModel.HasViewerDiskCharts,
            _viewModel.HasViewerGpuCharts,
            _viewModel.HasViewerNetworkCharts,
            _viewModel.HasViewerFanCharts
        };
        for (var index = 0; index < visibility.Length; index++)
        {
            expanders[index].Visibility = visibility[index] ? Visibility.Visible : Visibility.Collapsed;
        }
    }

    private static void SetColumns(Grid grid, bool isCompact, int expandedColumnCount)
    {
        if (grid.ColumnDefinitions.Count != expandedColumnCount)
        {
            return;
        }

        var columnCount = isCompact ? 1 : expandedColumnCount;
        for (var index = 0; index < grid.Children.Count; index++)
        {
            if (grid.Children[index] is FrameworkElement child)
            {
                Grid.SetColumn(child, index % columnCount);
                Grid.SetRow(child, index / columnCount);
            }
        }

        grid.ColumnDefinitions.Clear();
        for (var index = 0; index < columnCount; index++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        grid.RowDefinitions.Clear();
        var rowCount = (grid.Children.Count + columnCount - 1) / columnCount;
        for (var index = 0; index < rowCount; index++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }
    }

    private const int SwHide = 0;
    private const int SwRestore = 9;

    [DllImport("user32.dll", EntryPoint = "ShowWindow")]
    private static extern bool ShowWindowNative(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    private void SecretBox_OnPasswordChanged(object sender, RoutedEventArgs e)
    {
        if (sender is PasswordBox box && _viewModel.Secret != box.Password)
        {
            _viewModel.Secret = box.Password;
        }
    }

    private void ViewerAccessBox_OnPasswordChanged(object sender, RoutedEventArgs e)
    {
        if (sender is PasswordBox box && _viewModel.ViewerAccessKey != box.Password)
        {
            _viewModel.ViewerAccessKey = box.Password;
        }
    }

    private async void ViewerDeviceDetailsButton_OnClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button { DataContext: ViewerDeviceItemViewModel item })
        {
            await _viewModel.SelectViewerDeviceAsync(item.DeviceId);
        }
    }

    private async void ViewerDeviceList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is ListView { SelectedItem: ViewerDeviceItemViewModel item })
        {
            await _viewModel.SelectViewerDeviceAsync(item.DeviceId);
        }
    }

    private async void MetricWindow_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        await _viewModel.RefreshSelectedViewerDeviceAsync();
    }

    private void NavigationView_SelectionChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
    {
        var tag = (args.SelectedItem as NavigationViewItem)?.Tag?.ToString() ?? "monitor";
        MonitorPage.Visibility = tag == "monitor" ? Visibility.Visible : Visibility.Collapsed;
        LocalPage.Visibility = tag == "local" ? Visibility.Visible : Visibility.Collapsed;
        ServerPage.Visibility = tag == "server" ? Visibility.Visible : Visibility.Collapsed;
    }

    private void NavigationView_BackRequested(NavigationView sender, NavigationViewBackRequestedEventArgs args)
    {
        var monitorItem = AppNavigation.MenuItems
            .OfType<NavigationViewItem>()
            .FirstOrDefault(item => string.Equals(item.Tag?.ToString(), "monitor", StringComparison.Ordinal));
        if (monitorItem is not null)
        {
            AppNavigation.SelectedItem = monitorItem;
        }
    }

    private void InstanceMetricEditorButton_OnClick(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement { DataContext: ProbeInstanceItemViewModel item })
        {
            _viewModel.SelectInstanceMetricEditor(item);
        }
    }

    private void ClearInstanceMetricEditorButton_OnClick(object sender, RoutedEventArgs e)
    {
        _viewModel.ClearInstanceMetricEditor();
    }
}
