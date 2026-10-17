# 实时进程 GPU 指标

实时进程结果新增 `gpuPercent: number | null`。它表示该进程在采样窗口内最繁忙
GPU Engine 的 0–100% 占用率，不是整机 GPU 汇总值，也不把未知值伪装成 0。
首次采样、PID 复用、计数器回退、权限不足或驱动不提供进程统计时均返回 `null`。

## Agent 采集来源

| 平台 | 首选来源 | 降级与限制 |
| --- | --- | --- |
| Windows | PDH `\GPU Engine(*)\Utilization Percentage`，按实例中的 PID 汇总并取最忙 Engine | PDH 不可用或受保护进程不返回值时为 `null`；首个 PDH 查询只建立窗口 |
| Linux | `/proc/<pid>/fdinfo/*` 的 DRM `drm-engine-*` 纳秒计数器，按 Engine 做相邻快照差分 | NVIDIA 专有驱动的 DRM 信息不足时使用 NVML 进程利用率；两者都不可用时为 `null` |
| macOS | 特权 Agent 调用 `powermetrics --samplers tasks --show-process-gpu`，将 `GPU ms/s` 换算为百分比 | 需要机器级 LaunchDaemon 权限；普通用户运行、系统拒绝采样或 macOS 没有进程 GPU 输出时为 `null`。IOKit 的整机 GPU 值不用于推算进程值 |
| Android | 不采集主机进程 GPU；Android 端仍是查看端 | 主机 Agent 的平台结果按上述规则展示 |

所有平台都用 PID 加进程启动时间作为计数器身份，避免新进程继承旧 PID 的读数。
GPU 采样器不读取或修改历史上报采样器，因此实时查询不会改变历史时间序列。

## 协议与界面

- 实时 Hub revision 从 2 升为 3。revision 3 的进程项总是带有可空 `gpuPercent`。
- 新 Hub 接收仍在运行的旧 Agent 时，会把缺失字段规范化为 `null`；新 Agent 连接旧 Hub
  时会省略该字段，保持严格 schema 兼容。
- 进程表增加 GPU 列、占用条和排序；`—` 明确表示没有读到，不表示空闲。
- 不修改历史 GPU 指标、Redis 时间序列或数据库 schema。
