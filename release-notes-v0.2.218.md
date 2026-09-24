# v0.2.218 测试版

## CLI 探测补全

- CLI 接入新版探测状态协议，展示目标实例、组件指标、探测时间、温度源和传感器后端状态。
- 新增 `dsc probes status` 与 `dsc probes detect`，配置指标或探针来源后会刷新探测结果。
- 一次性硬件探测同时返回风扇实例，CLI 可直接配置风扇上报。
- Windows CLI 包和安装器携带 LibreHardwareMonitor 与硬件传感器探测资源。

## 验证范围

- 本地仅执行版本一致性、格式、差异和脚本静态检查。
- Go 测试、构建、Windows/Linux CLI 打包及 release 资产检查由 GitHub Actions 执行。
- 发布后使用 workstation 的 Windows GUI setup 验证安装结果。
