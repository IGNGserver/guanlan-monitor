# v0.2.47 测试版

## 全平台数据展示

- Web、Android、iOS 统一适配当前 `/metrics` 数据协议，展示设备状态、上报时间、CPU、内存、磁盘、网卡、GPU、风扇和传感器后端信息。
- 补齐实例级历史趋势：CPU 频率/温度、内存可用/缓存/已提交/已用、进程/线程/句柄、磁盘读写/活动/温度、网卡收发与累计流量、GPU 编解码/频率/显存/温度、风扇转速。
- 磁盘趋势按需求保留读取速度和写入速度两条主线，不再以容量使用率作为磁盘速度图表。
- iOS 指标配置切换到服务器当前的 `enabledMetrics` 协议，修复旧配置字段导致的读取和保存异常。

## 发布说明

- 本版本为测试版 release。
- Windows GUI setup、portable、update、CLI、Linux CLI、Android 和 iOS 资产由 GitHub Actions 构建。
