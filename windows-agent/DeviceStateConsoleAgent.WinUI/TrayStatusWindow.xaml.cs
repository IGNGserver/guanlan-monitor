using DeviceStateConsoleAgent.WinUI.Common;
using DeviceStateConsoleAgent.WinUI.ViewModels;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Windows.Graphics;
using System.Runtime.InteropServices;
using WinRT.Interop;

namespace DeviceStateConsoleAgent.WinUI;

public sealed partial class TrayStatusWindow : Window
{
    private AppWindow? _appWindow;
    private bool _allowClose;
    private bool _windowConfigured;
    private bool _isVisible;

    public TrayStatusWindow(MainViewModel viewModel)
    {
        InitializeComponent();
        Activated += TrayStatusWindow_Activated;
        RootGrid.DataContext = viewModel;
    }

    public bool IsVisible => _isVisible;

    public void ShowNearTray()
    {
        EnsureWindowConfigured();
        GetCursorPos(out var cursor);
        var displayArea = DisplayArea.GetFromPoint(new PointInt32(cursor.X, cursor.Y), DisplayAreaFallback.Primary);
        var workArea = displayArea.WorkArea;
        const int width = 260;
        const int height = 150;
        var x = Math.Max(workArea.X, Math.Min(cursor.X - width + 32, workArea.X + workArea.Width - width));
        var y = Math.Max(workArea.Y, Math.Min(cursor.Y - height - 16, workArea.Y + workArea.Height - height));
        var hwnd = WindowNative.GetWindowHandle(this);
        _appWindow?.Show();
        ShowWindowNative(hwnd, SwShowNoActivate);

        if (!SetWindowPos(hwnd, HwndTopmost, x, y, width, height, SwpShowWindow | SwpNoActivate))
        {
            LogWindowFailure("SetWindowPos");
        }

        SetForegroundWindow(hwnd);
        Activate();
        _isVisible = true;
    }

    public void HideWindow()
    {
        _isVisible = false;
        if (_windowConfigured)
        {
            ShowWindowNative(WindowNative.GetWindowHandle(this), SwHide);
        }
    }

    public void PrepareForExit()
    {
        _allowClose = true;
    }

    private void TrayStatusWindow_Activated(object sender, WindowActivatedEventArgs args)
    {
        if (args.WindowActivationState == WindowActivationState.Deactivated && _isVisible)
        {
            HideWindow();
        }
    }

    private void AppWindow_Closing(AppWindow sender, AppWindowClosingEventArgs args)
    {
        if (_allowClose)
        {
            return;
        }

        args.Cancel = true;
        HideWindow();
    }

    private void EnsureWindowConfigured()
    {
        if (_windowConfigured)
        {
            return;
        }

        _appWindow = WindowInterop.GetAppWindow(this);
        if (_appWindow.Presenter is OverlappedPresenter presenter)
        {
            presenter.IsAlwaysOnTop = true;
            presenter.IsResizable = false;
            presenter.IsMaximizable = false;
            presenter.IsMinimizable = false;
            presenter.SetBorderAndTitleBar(false, false);
        }

        _appWindow.Resize(new SizeInt32(260, 150));
        _appWindow.Closing += AppWindow_Closing;
        _windowConfigured = true;
    }

    private void OpenButton_OnClick(object sender, RoutedEventArgs e)
    {
        HideWindow();
        if (Application.Current is App app)
        {
            app.ShowMainWindow();
        }
    }

    private void ExitButton_OnClick(object sender, RoutedEventArgs e)
    {
        if (Application.Current is App app)
        {
            app.ExitFromTray();
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Point
    {
        public int X;
        public int Y;
    }

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out Point lpPoint);

    private static readonly IntPtr HwndTopmost = new(-1);
    private const uint SwpNoActivate = 0x0010;
    private const uint SwpShowWindow = 0x0040;
    private const int SwHide = 0;
    private const int SwShowNoActivate = 4;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint flags);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll", EntryPoint = "ShowWindow")]
    private static extern bool ShowWindowNative(IntPtr hWnd, int nCmdShow);

    private static void LogWindowFailure(string operation)
    {
        var error = Marshal.GetLastWin32Error();
        File.AppendAllText(
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DeviceStateConsoleAgent", "frontend-startup.log"),
            $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} TrayStatusWindow {operation} failed, win32={error}{Environment.NewLine}");
    }

}
