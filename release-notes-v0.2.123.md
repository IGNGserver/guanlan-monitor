# v0.2.123 测试版

## 修复桌面端遥测图表时间点选中高亮变形拉长问题

- 修复桌面端 `TelemetryChart` 和 `MiniTrend` 图表中选中的时间点标记被 SVG `preserveAspectRatio="none"` 变形拉长为椭圆的问题。
- 将选中点高亮 Marker 升级为 HTML 绝对定位浮层 (正圆)，结合 `border-radius: 50%` 与百分比坐标定位，不受 SVG 坐标系长宽比拉伸影响，保证在任何分辨率与窗口比例下均呈现完美正圆形。
