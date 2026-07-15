using System.Runtime.InteropServices;
using Microsoft.UI.Dispatching;

namespace DeviceStateConsoleAgent.WinUI.Services;

public sealed class TrayIconService : IDisposable
{
    private const int WmUser = 0x0400;
    private const int TrayCallbackMessage = WmUser + 1;
    private const int WmContextMenu = 0x007B;
    private const int WmLButtonDown = 0x0201;
    private const int WmLButtonUp = 0x0202;
    private const int WmLButtonDoubleClick = 0x0203;
    private const int WmRButtonUp = 0x0205;
    private const int WmNCRButtonUp = 0x00A5;
    private const uint NifMessage = 0x00000001;
    private const uint NifIcon = 0x00000002;
    private const uint NifTip = 0x00000004;
    private const uint NifGuid = 0x00000020;
    private const uint NimAdd = 0x00000000;
    private const uint NimDelete = 0x00000002;
    private const uint NimSetVersion = 0x00000004;
    private const uint NotifyIconVersion4 = 4;
    private const uint ImageIcon = 1;
    private const uint LrLoadFromFile = 0x00000010;
    private const uint LrDefaultSize = 0x00000040;
    private const int CwUseDefault = unchecked((int)0x80000000);
    private static readonly Guid TrayGuid = new("1B6D3B6E-8F21-4C87-A36B-6A7ED7A79D5D");

    private readonly Action _openWindow;
    private readonly Action _toggleStatusFlyout;
    private readonly Action<string> _log;
    private readonly DispatcherQueue _dispatcherQueue;
    private readonly string _windowClassName = $"GuanLanTray_{Guid.NewGuid():N}";
    private readonly WndProc _wndProc;
    private IntPtr _windowHandle;
    private IntPtr _iconHandle;
    private bool _disposed;

    public TrayIconService(
        string iconPath,
        Action openWindow,
        Action toggleStatusFlyout,
        Action<string> log)
    {
        _openWindow = openWindow;
        _toggleStatusFlyout = toggleStatusFlyout;
        _log = log;
        _dispatcherQueue = DispatcherQueue.GetForCurrentThread()
            ?? throw new InvalidOperationException("Tray icon must be initialized on the UI thread.");
        _wndProc = WindowProcedure;
        CreateMessageWindow();
        LoadTrayIcon(iconPath);
        AddTrayIcon();
        _log("Tray icon initialized with native notify icon");
    }

    private void CreateMessageWindow()
    {
        var instance = GetModuleHandle(null);
        var windowClass = new WndClass
        {
            lpszClassName = _windowClassName,
            lpfnWndProc = _wndProc,
            hInstance = instance
        };

        if (RegisterClass(ref windowClass) == 0)
        {
            throw new InvalidOperationException("Failed to register tray icon window class.");
        }

        _windowHandle = CreateWindowEx(
            0,
            _windowClassName,
            _windowClassName,
            0,
            CwUseDefault,
            CwUseDefault,
            0,
            0,
            IntPtr.Zero,
            IntPtr.Zero,
            instance,
            IntPtr.Zero);

        if (_windowHandle == IntPtr.Zero)
        {
            throw new InvalidOperationException("Failed to create tray icon message window.");
        }
    }

    private void LoadTrayIcon(string iconPath)
    {
        if (File.Exists(iconPath))
        {
            _iconHandle = LoadImage(IntPtr.Zero, iconPath, ImageIcon, 0, 0, LrLoadFromFile | LrDefaultSize);
        }

        if (_iconHandle == IntPtr.Zero)
        {
            _iconHandle = LoadIcon(IntPtr.Zero, (IntPtr)0x7F00);
        }
    }

    private void AddTrayIcon()
    {
        var data = CreateNotifyIconData();
        if (!Shell_NotifyIcon(NimAdd, ref data))
        {
            throw new InvalidOperationException("Failed to add tray icon.");
        }

        data.uVersion = NotifyIconVersion4;
        Shell_NotifyIcon(NimSetVersion, ref data);
    }

    private NotifyIconData CreateNotifyIconData()
    {
        return new NotifyIconData
        {
            cbSize = (uint)Marshal.SizeOf<NotifyIconData>(),
            hWnd = _windowHandle,
            uID = 1,
            uFlags = NifMessage | NifIcon | NifTip | NifGuid,
            uCallbackMessage = TrayCallbackMessage,
            hIcon = _iconHandle,
            szTip = "观澜",
            guidItem = TrayGuid
        };
    }

    private IntPtr WindowProcedure(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam)
    {
        if (msg == TrayCallbackMessage)
        {
            // NotifyIcon version 4 packs the mouse message with icon coordinates.
            var callbackValue = unchecked((uint)(long)lParam);
            var mouseMessage = (int)(callbackValue & 0xFFFF);
            _log($"Tray callback received: 0x{callbackValue:X} (message 0x{mouseMessage:X})");
            switch (mouseMessage)
            {
                case WmLButtonUp:
                    Dispatch("Tray left click dispatched", _openWindow);
                    break;
                case WmRButtonUp:
                case WmNCRButtonUp:
                case WmContextMenu:
                    Dispatch("Tray right click dispatched", _toggleStatusFlyout);
                    break;
            }
        }

        return DefWindowProc(hwnd, msg, wParam, lParam);
    }

    private void Dispatch(string message, Action action)
    {
        _dispatcherQueue.TryEnqueue(() =>
        {
            _log(message);
            action();
        });
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        var data = CreateNotifyIconData();
        Shell_NotifyIcon(NimDelete, ref data);
        if (_iconHandle != IntPtr.Zero)
        {
            DestroyIcon(_iconHandle);
            _iconHandle = IntPtr.Zero;
        }
        if (_windowHandle != IntPtr.Zero)
        {
            DestroyWindow(_windowHandle);
            _windowHandle = IntPtr.Zero;
        }
    }

    private delegate IntPtr WndProc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WndClass
    {
        public uint style;
        public WndProc lpfnWndProc;
        public int cbClsExtra;
        public int cbWndExtra;
        public IntPtr hInstance;
        public IntPtr hIcon;
        public IntPtr hCursor;
        public IntPtr hbrBackground;
        public string? lpszMenuName;
        public string lpszClassName;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NotifyIconData
    {
        public uint cbSize;
        public IntPtr hWnd;
        public uint uID;
        public uint uFlags;
        public uint uCallbackMessage;
        public IntPtr hIcon;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string szTip;
        public uint dwState;
        public uint dwStateMask;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string szInfo;
        public uint uVersion;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string szInfoTitle;
        public uint dwInfoFlags;
        public Guid guidItem;
        public IntPtr hBalloonIcon;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] private static extern bool Shell_NotifyIcon(uint message, ref NotifyIconData data);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern ushort RegisterClass(ref WndClass windowClass);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateWindowEx(int exStyle, string className, string windowName, int style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);
    [DllImport("user32.dll")] private static extern IntPtr DefWindowProc(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool DestroyWindow(IntPtr window);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool DestroyIcon(IntPtr icon);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr GetModuleHandle(string? moduleName);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr LoadImage(IntPtr instance, string name, uint type, int width, int height, uint flags);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr LoadIcon(IntPtr instance, IntPtr iconName);
}
