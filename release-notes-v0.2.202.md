# v0.2.202

- 修正 Windows 安装包只携带 PawnIO、却没有执行安装的问题；安装包现在会在启动桌面 Agent 前静默安装随包驱动，为 LibreHardwareMonitor 的 CPU Package 温度读取准备底层访问能力。
- 传感器探针新增 PawnIO 安装、加载和版本诊断，并保留硬件传感器后端状态，即使风扇采集未启用也能定位 CPU 温度不可用原因。
- 不使用不准确的 ACPI 热区值冒充 CPU Package 温度；核显温度继续在 CPU Package 温度可用时复用 CPU 温度。
