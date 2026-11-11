# v0.2.15

## 修复启动崩溃与空指针闪退问题
- **修复初始化空指针崩溃**：解决了由于 XAML 提前设置 `IsSelected="True"` 导致在控件构造期间提前触发 SelectionChanged 抛出 `NullReferenceException` 导致程序静默闪退的问题。
- **完善空值安全防护**：为所有 XAML 事件响应添加严格的 `null` 校验与安全延迟挂载机制。
