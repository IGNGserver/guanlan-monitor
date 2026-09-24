# v0.2.16

## 修复 P/Invoke 入口与 XAML Panel 崩溃问题
- **修复 ShowWindow Native 映射**：补全 `user32.dll` 平台调用的 `EntryPoint = "ShowWindow"`，解决窗口显隐调用触发 `EntryPointNotFoundException` 导致进程闪退的问题。
- **修复 ItemsPanel 模板继承违例**：将 `OverviewGrid` 中的 `ItemsControl` 替换为适配 `UniformGridLayout` 的原生 `ItemsRepeater`，解决 `The ItemsControl.ItemsPanelTemplate must have a derivative of Panel as the root element` 的框架崩溃异常。
