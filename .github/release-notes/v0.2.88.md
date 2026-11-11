# v0.2.88

- 全面升级设备状态页面图表系统，全方位提升运维实用性。
- 引入 TelemetryChartCard 控件，支持单/多系列趋势线与 Cur/Avg/Max/Min 交互标盘脚标。
- 新增设备详情页 Tab 分类导航（综合面板、算力与内存、存储与网络、显卡与散热、全景视图）。
- 新增多网卡、多磁盘、多 GPU 实例独立的图表切卡与筛选器。
- 升级总览页 (OverviewPage)，新增 CPU/内存 Top 5 资源消耗排行榜与全网实时吞吐统计。
- 修复后端本地仓储 (local.ts) TypeScript 编译阶段 deviceRegistry 闭包可能未定义的类型推断错漏。
