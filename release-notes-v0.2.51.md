# Device State Console v0.2.51（测试版）

## 本次更新

- Windows agent 启用 LibreHardwareMonitor 的 Storage 节点，采集磁盘温度、SMART 健康状态、寿命百分比和 SMART 属性。
- Windows 增加 `smartctl`（若系统已安装）与 Storage Reliability Counter 回退；Linux 增加同一套 `smartctl` JSON 回退。
- 风扇转速继续使用 LibreHardwareMonitor 的只读传感器链；当主板/EC 未暴露 RPM 时明确上报传感器状态，不生成伪数据。
- 网页、Android、iOS 的磁盘详情显示温度、健康状态、寿命、健康来源和 SMART 属性；温度保留历史曲线，健康信息使用文本属性展示。
- 统一共享磁盘数据模型并同步版本号。

## 说明

`FanControl` 的界面源码不是本项目的依赖来源；本版本使用其公开说明所指向的 LibreHardwareMonitor 传感器库。`smartctl` 作为可选系统组件使用，不会把 GPL 程序源码复制进本项目。
