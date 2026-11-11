# Device State Console v3.0.158 (测试版)

## Highlights

- 为实时进程列表增加跨平台的进程级 GPU 占用指标。
- Windows 使用 GPU Engine counters，Linux 使用 DRM/NVML 降级路径，macOS 使用特权 `powermetrics` 采样。
- 不支持、无权限、首次采样或计数器异常时返回 `null`，不伪造为 0。
- 实时进程协议 revision 升至 3，并保持旧 Agent/Hub 的字段兼容。
- 进程表新增 GPU 列、占用条和排序。

## Headless delivery

- Linux/Windows headless service 继续使用固定版本资产和现有回滚检查。
- 本版本为测试版（test channel），不是正式稳定发布。
- 真实 Windows WDDM、Intel/AMD/NVIDIA Linux DRM/NVML、Intel Mac 和 Apple Silicon Mac 的硬件验收仍需单独进行。
