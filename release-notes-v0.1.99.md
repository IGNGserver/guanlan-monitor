# Device State Console v0.1.99

## Windows 观澜

- 修复开机时多个启动入口导致的重复窗口，并加入进程级单实例保护。
- 新增“开机时静默进入托盘”选项；启动记录由实际登录用户维护。
- 重构托盘状态菜单：使用圆角 WinUI 界面、淡入动画、精确贴近托盘图标定位，并在点击任意外部位置时自动收起。
- 修复托盘右键多重回调可能导致菜单重复打开或进程崩溃的问题。
- 监测页面主体改为左对齐，侧栏收起后内容会随可用区域向左移动。

## Assets

| 文件 | SHA-256 |
| --- | --- |
| `DeviceStateConsoleAgent-setup-0.1.99.exe` | `B936254ED3D2BCD23E4D69FD72DEE3CDFA7893BC06B39518E2676A35CE0F2D0E` |
| `DeviceStateConsoleAgent-update-0.1.99.zip` | `C8625AB1E293EC465DB3128CFB17F1442E2FDEEAD37719BBF5F9E9454B518986` |
