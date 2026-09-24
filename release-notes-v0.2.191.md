# v0.2.191

### 修复与优化
1. **NVIDIA 独立显卡与多显卡数据采集/合并全面修复与增强**：
   - 彻底修复 `collectNvidiaGPUs` 中因严格正数校验（`isFinitePositive`）导致待机空闲状态下 0% GPU 使用率与 0 MB 显存被丢弃的缺陷，新增 `parseNonNegativeFloat` 确保非负数值正确解析。
   - 增强显卡多源合并算法（`mergeGPUStats`），增加基于厂商 PCI 硬件标识（NVIDIA `VEN_10DE`、Intel `VEN_8086`、AMD `VEN_1002`）与硬件序号的回退匹配能力，完美解决 Windows WMI 设备名（如 `NVIDIA GeForce RTX 2060 SUPER`）与 `nvidia-smi` 底层上报名称（如 `NVIDIA CMP 40HX` 魔改/矿卡核心）不一致导致多源合并匹配失败的问题。
   - 在 Windows GPU 采集器中自动过滤 GameViewer、Parsec、RDP 等虚拟显示适配器（`ROOT\DISPLAY`、`SWD\` 等），避免显卡列表污染与索引偏移。
   - 过滤 Windows 性能计数器中的空闲/虚拟通道（<= 64KB 伪共享显存），杜绝将 8KB 虚假显存数据覆盖至物理独立显卡。
