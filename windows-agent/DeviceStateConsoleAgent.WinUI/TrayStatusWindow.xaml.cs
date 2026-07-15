using DeviceStateConsoleAgent.WinUI.Common;
using DeviceStateConsoleAgent.WinUI.ViewModels;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media.Animation;
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
    private readonly DispatcherQueueTimer _dismissTimer;

    public TrayStatusWindow(MainViewModel viewModel)
    {
        InitializeComponent();
        Activated += TrayStatusWindow_Activated;
        RootGrid.DataContext = viewModel;
        _dismissTimer = DispatcherQueue.CreateTimer();
        _dismissTimer.Interval = TimeSpan.FromMilliseconds(120);
        _dismissTimer.Tick += (_, _) => DismissWhenForegroundChanges();
    }

    public bool IsVisible => _isVisible;

    public void ShowNearTray(int anchorX, int anchorY)
    {
        EnsureWindowConfigured();
        var hwnd = WindowNative.GetWindowHandle(this);
        var scale = Math.Max(1, GetDpiForWindow(hwnd) / 96d);
        var width = (int)Math.Ceiling(340 * scale);
        var height = (int)Math.Ceiling(220 * scale);
        var displayArea = DisplayArea.GetFromPoint(new PointInt32(anchorX, anchorY), DisplayAreaFallback.Primary);
        var workArea = displayArea.WorkArea;
        var x = Math.Max(workArea.X, Math.Min(anchorX - width + 28, workArea.X + workArea.Width - width));
        var y = Math.Max(workArea.Y, Math.Min(anchorY - height - 10, workArea.Y + workArea.Height - height));

        _appWindow?.MoveAndResize(new RectInt32(x, y, width, height));
        if (!SetWindowPos(hwnd, HwndTopmost, x, y, width, height, SwpShowWindow | SwpFrameChanged))
        {
            LogWindowFailure("SetWindowPos");
        }

        ShowWindowNative(hwnd, SwShow);
        SetForegroundWindow(hwnd);
        Activate();
        _isVisible = true;
        _dismissTimer.Start();
        PlayEntranceAnimation();
    }

    public void HideWindow()
    {
        _isVisible = false;
        _dismissTimer.Stop();
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
        _appWindow.IsShownInSwitchers = false;
        if (_appWindow.Presenter is OverlappedPresenter presenter)
        {
            presenter.IsAlwaysOnTop = true;
            presenter.IsResizable = false;
            presenter.IsMaximizable = false;
            presenter.IsMinimizable = false;
            presenter.SetBorderAndTitleBar(false, false);
        }

        var hwnd = WindowNative.GetWindowHandle(this);
        var exStyle = GetWindowLongPtr(hwnd, GwlExStyle).ToInt64();
        exStyle = (exStyle | WsExToolWindow) & ~WsExAppWindow;
        SetWindowLongPtr(hwnd, GwlExStyle, new IntPtr(exStyle));
        var style = GetWindowLongPtr(hwnd, GwlStyle).ToInt64();
        style = (style & ~(WsCaption | WsThickFrame | WsSysMenu | WsMinimizeBox | WsMaximizeBox)) | WsPopup;
        SetWindowLongPtr(hwnd, GwlStyle, new IntPtr(style));
        _appWindow.Closing += AppWindow_Closing;
        _windowConfigured = true;
    }

    private void PlayEntranceAnimation()
    {
        MenuSurface.Opacity = 0;
        MenuTransform.Y = 10;
        var storyboard = new Storyboard();
        storyboard.Children.Add(new DoubleAnimation
        {
            To = 1,
            Duration = TimeSpan.FromMilliseconds(160),
            EnableDependentAnimation = true
        });
        Storyboard.SetTarget(storyboard.Children[0], MenuSurface);
        Storyboard.SetTargetProperty(storyboard.Children[0], "Opacity");
        storyboard.Children.Add(new DoubleAnimation
        {
            To = 0,
            Duration = TimeSpan.FromMilliseconds(180),
            EnableDependentAnimation = true
        });
        Storyboard.SetTarget(storyboard.Children[1], MenuTransform);
        Storyboard.SetTargetProperty(storyboard.Children[1], "Y");
        storyboard.Begin();
    }

    private void OpenButton_OnClick(object sender, RoutedEventArgs e)
    {
        HideWindow();
        if (Application.Current is App app)
        {
            app.ShowMainWindow();
        }
    }

    private void DismissWhenForegroundChanges()
    {
        if (!_isVisible)
        {
            _dismissTimer.Stop();
            return;
        }

        var hwnd = WindowNative.GetWindowHandle(this);
        if (GetForegroundWindow() != hwnd)
        {
            HideWindow();
        }
    }

    private void ExitButton_OnClick(object sender, RoutedEventArgs e)
    {
        if (Application.Current is App app)
        {
            app.ExitFromTray();
        }
    }

    [DllImport("user32.dll")]
    private static extern uint GetDpiForWindow(IntPtr hwnd);

    private static readonly IntPtr HwndTopmost = new(-1);
    private const int GwlStyle = -16;
    private const int GwlExStyle = -20;
    private const long WsPopup = unchecked((long)0x80000000);
    private const long WsCaption = 0x00C00000L;
    private const long WsThickFrame = 0x00040000L;
    private const long WsSysMenu = 0x00080000L;
    private const long WsMinimizeBox = 0x00020000L;
    private const long WsMaximizeBox = 0x00010000L;
    private const long WsExToolWindow = 0x00000080L;
    private const long WsExAppWindow = 0x00040000L;
    private const uint SwpShowWindow = 0x0040;
    private const uint SwpFrameChanged = 0x0020;
    private const int SwHide = 0;
    private const int SwShow = 5;

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW", SetLastError = true)]
    private static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)]
    private static extern IntPtr SetWindowLongPtr(IntPtr hwnd, int index, IntPtr value);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint flags);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

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
