using DeviceStateConsoleAgent.WinUI.Services;
using DeviceStateConsoleAgent.WinUI.ViewModels;
using Microsoft.UI.Xaml;

namespace DeviceStateConsoleAgent.WinUI;

public partial class App : Application
{
    private readonly string _startupLogDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "DeviceStateConsoleAgent");
    private readonly string _startupLogPath;
    private MainViewModel? _viewModel;
    private MainWindow? _mainWindow;
    private TrayStatusWindow? _trayWindow;
    private TrayIconService? _trayIconService;
    private bool _isExiting;

    public App()
    {
        _startupLogPath = Path.Combine(_startupLogDir, "frontend-startup.log");
        Directory.CreateDirectory(_startupLogDir);
        LogStartup("App ctor: before InitializeComponent");
        InitializeComponent();
        LogStartup("App ctor: InitializeComponent complete");
        UnhandledException += App_UnhandledException;
    }

    protected override async void OnLaunched(Microsoft.UI.Xaml.LaunchActivatedEventArgs args)
    {
        try
        {
            var launchArgs = ResolveLaunchArguments(args);
            LogStartup($"OnLaunched: args='{launchArgs}'");
            _viewModel ??= new MainViewModel();
            LogStartup("OnLaunched: MainViewModel created");
            _mainWindow ??= new MainWindow(_viewModel);
            LogStartup("OnLaunched: MainWindow created");
            _mainWindow.Activate();
            LogStartup("OnLaunched: MainWindow activated");

            var startMinimized = launchArgs.Contains("--minimized", StringComparison.OrdinalIgnoreCase);
            await CompleteLaunchAsync(startMinimized);
            LogStartup("OnLaunched: CompleteLaunchAsync finished");
        }
        catch (Exception ex)
        {
            LogStartup($"OnLaunched exception: {ex}");
            throw;
        }
    }

    public void ShowMainWindow()
    {
        LogStartup("ShowMainWindow: requested from tray");
        _trayWindow?.HideWindow();
        if (_mainWindow is not null)
        {
            _mainWindow.ShowWindow();
            LogStartup("ShowMainWindow: completed");
        }
    }

    public void ExitFromTray()
    {
        if (_isExiting)
        {
            return;
        }

        _isExiting = true;
        _trayIconService?.Dispose();
        _trayIconService = null;
        _trayWindow?.PrepareForExit();
        _trayWindow?.Close();
        _mainWindow?.PrepareForExit();
        _mainWindow?.Close();
        Exit();
    }

    private async Task CompleteLaunchAsync(bool startMinimized)
    {
        if (_mainWindow is null)
        {
            return;
        }

        await _mainWindow.EnsureInitializedAsync();
        LogStartup("CompleteLaunchAsync: MainWindow initialization complete");
        _trayIconService ??= new TrayIconService(
            ResolveTrayIconPath(),
            ShowMainWindow,
            ToggleTrayStatusWindow,
            LogStartup);
        LogStartup("CompleteLaunchAsync: tray icon initialized");

        if (startMinimized)
        {
            _mainWindow.HideWindow();
            return;
        }

        ShowMainWindow();
    }

    private void ToggleTrayStatusWindow()
    {
        _trayWindow ??= _viewModel is null ? null : new TrayStatusWindow(_viewModel);
        if (_trayWindow is null)
        {
            return;
        }

        if (_trayWindow.IsVisible)
        {
            _trayWindow.HideWindow();
            return;
        }

        _trayWindow.ShowNearTray();
        LogStartup("ToggleTrayStatusWindow: shown");
    }

    private string ResolveTrayIconPath()
    {
        var primary = Path.Combine(AppContext.BaseDirectory, "app-icon.ico");
        if (File.Exists(primary))
        {
            return primary;
        }

        return Path.Combine(AppContext.BaseDirectory, "Assets", "app-icon.ico");
    }

    private void App_UnhandledException(object sender, Microsoft.UI.Xaml.UnhandledExceptionEventArgs e)
    {
        LogStartup($"UnhandledException: {e.Exception}");
    }

    private static string ResolveLaunchArguments(Microsoft.UI.Xaml.LaunchActivatedEventArgs args)
    {
        if (!string.IsNullOrWhiteSpace(args.Arguments))
        {
            return args.Arguments;
        }

        var commandLineArgs = Environment.GetCommandLineArgs();
        if (commandLineArgs.Length <= 1)
        {
            return string.Empty;
        }

        return string.Join(" ", commandLineArgs.Skip(1));
    }

    private void LogStartup(string message)
    {
        var line = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} {message}";
        File.AppendAllText(_startupLogPath, line + Environment.NewLine);
    }
}
