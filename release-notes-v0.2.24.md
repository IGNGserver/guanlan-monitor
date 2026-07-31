# v0.2.24

## 侧边栏设备切换异步指标调取与实时数据全量提取
- **修复侧边栏设备切换数据不联动 Bug**：补齐 `SelectedViewerDeviceId` 变动时的底层 `RefreshSelectedViewerDeviceAsync()` 异步数据请求逻辑，彻底解决在侧边栏切换设备（如切 `devbox` / `server` / `ubuntu-vm`）时“页面只改了名字、实际图表与数据依然留在旧设备”的严重故障！
- **全量真实数据包解析提取**：实现了对 `latest` 数据包中 `MemoryUsedBytes` / `MemoryTotalBytes` / `DiskUsedBytes` / `DiskTotalBytes` / `CpuUsagePercent` / `CpuFrequencyMHz` / `LastSeenAt` 等真实指标的全面提取解析，自动计算填满数据网格。
