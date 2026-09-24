# v0.2.23

## 下拉框去重、真实 DTO 全量解包与排版视觉清洗
- **下拉框去重修复**：废弃直接传递 Chart 列表的原始做法，在 ViewModel 中根据硬件设备/分区名实施去重过滤。特定设备下拉菜单中精确仅包含唯一选项（如 `全部磁盘`、`C:`、`D:`；`全部网络`、`Wi-Fi`、`以太网`），绝不再发生连续 4 个`全部磁盘`与 5 个`C:`重复展开的故障。
- **真实 DTO 字段全量提取解析**：深入提取服务端传输包中的 `ReadBytesPerSec` / `WriteBytesPerSec` / `TotalBytes` / `RxBytesPerSec` / `TxBytesPerSec` / `IpAddresses` / `FrequencyMHz` / `Cores` 等原生真实指标，并自动格式化输出。
- **清除多重重复文本与文字对齐遮挡**：清洗走势图内部的三重 CPU 型号提示框，清理第 2 列与第 3 列重复出现的属性标签，保证 3 列网格清爽对齐。
