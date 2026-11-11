# v0.2.43 测试版

- 修复 Windows App SDK 1.6 不支持两参数 `CoreWebView2Environment.CreateAsync` 导致的 Windows 构建失败。
- 使用进程级 `WEBVIEW2_USER_DATA_FOLDER` 指定可写的 WebView2 用户数据目录。
