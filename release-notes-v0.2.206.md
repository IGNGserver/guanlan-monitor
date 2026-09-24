# v0.2.206 测试版

## Windows 温度采集与 GPU 显存汇总修复

- 修正 Windows Agent 的 LibreHardwareMonitor 选择顺序，优先使用安装包内的传感器库，避免被旧版 FanControl 库覆盖。
- 将 PowerShell 传感器探针的标准错误写入诊断详情，并显示实际使用的传感器库路径，便于定位权限或驱动问题。
- 单 CPU 封装设备将 CPU Package/Core 汇总温度同步到 CPU 实例和核显温度，保持 CPU、核显温度来源一致。
- 服务端保留历史 CPU 温度序列，并在最新样本暂时为空时继续向前端声明该指标可用。
- 总览中的 GPU 显存图改为全部显卡实例的已用显存总和，不再按显卡实例求平均。

## 验证说明

这是测试版，不代表稳定发布。构建、打包和 Windows 安装验收由 GitHub Actions 完成。
