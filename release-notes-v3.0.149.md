# Device State Console v3.0.149

本版为客户端 headless（无人值守服务）占用的第一轮优化。采样节奏（30s/60s）、上报数据结构与服务生命周期均不变，无用户可见行为变化；关闭指标的配置从此真正降低采集成本。

## 优化

- **Windows 常态开销减半**：SYSTEM 硬件传感器 helper 的 LHM 探针从每 30 秒改为每 60 秒（缓存 2 分钟内有效，采集器仍每个慢周期从缓存读取）；CPU L3 缓存兜底并入 10 分钟库存刷新，不再每个慢周期启动一次 PowerShell。
- **Linux 路径**：进程/线程/fd 统计从每 30 秒改为随慢周期（60s）刷新；无 hwmon 磁盘的 `smartctl -A` 温度兜底并入 2 分钟磁盘传感器 TTL，缓存命中时不再启动 smartctl。
- **指标开关真正生效**：此前关闭的指标只在采集完成后被过滤，采集开销不变；现在对应的采集路径会被跳过（存在实例级覆盖时仍保持采集，保证数据不丢）。
- **探针计数修正**：只统计真正启动的进程（缺失的可选工具不再计入、PowerShell 不再双计），性能审计数据可信。

## 修复

- 机器级服务的后端诊断日志增加 2 MiB 上限与半量截断，长时间运行不再无限增长。
- 性能审计 workflow 的 `baseline_ref` 基线构建修复（浅克隆导致 `git worktree add` 失败），同 runner 前后对比从此可用。

## 校验

- 本地 Linux 生产节奏实测：稳态外部探针 3→0，采集器 CPU 0.291%→0.056%（单核），内存与上报 payload 不变。
- CI 同 runner 对比：Windows 探针 20.0→7.4 次/分钟，Linux 2.7→0 次/分钟；快周期零探针不变量保持。
- `ci.yml` 全绿（Go Linux/Windows、Electron 与 Web 视觉回归、桌面与 Android 校验）。

## 安装包

- Windows setup、Windows portable、Windows update、Linux install 与 Android APK 均随本 Release 发布，并附带 `.sha256` 校验文件。
