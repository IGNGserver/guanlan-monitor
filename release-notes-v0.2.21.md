# v0.2.21

## 图表稳定展示与右侧第3列硬件参数全量绑定修复
- **图表全屏渲染修复**：废弃 `ItemsRepeater` 布局死结，直接将全宽 `MetricLineChart` 绑定至 `SelectedCategoryChart`，彻底解决在 `ScrollViewer` 内部因高度与宽度压缩导致画板全黑的问题。
- **右侧第 3 列彻底动态化**：XAML 中的 `物理内核` 静态硬编码标签已成功替换为动态 `TaskManagerRightLabel1~4` 与 `TaskManagerRightValue1~4`，在内存、磁盘、网络等非 CPU 页面绝对不再残留“物理内核: 8”等静态字符。
