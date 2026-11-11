# v0.2.207

- 修正 Windows 普通桌面令牌无法读取 LibreHardwareMonitor CPU 温度的问题：安装包注册 SYSTEM 硬件传感器辅助任务，周期性缓存特权传感器结果，桌面 Agent 仅复用新鲜缓存并继续负责上传。
- 核显温度继续复用 CPU Package 温度；不使用不准确的 ACPI 热区值替代 CPU Package 温度。
