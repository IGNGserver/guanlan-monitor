# macOS 支持与验收记录

基线：`d6f4ec9a` / 3.0.151。复用 Electron、Go agent、共享协议与 Hub。
目标为原生 arm64 / amd64，macOS 13 及以上；最低系统版本仍须实机验收。

## 阶段与证据

| 阶段 | 内容 | 完成条件 |
| --- | --- | --- |
| P0 | 语义、能力、安全边界 | 下表覆盖全部 35 个现有指标；不凭空补值 |
| P1 | 身份、配置、上报、更新契约 | macOS 不再被认作 Linux；旧客户端兼容；架构选择严格匹配 |
| P2 | Darwin 采集 | Mach/sysctl、IOKit、SMC、IOReport；解析/降级测试及双架构 CI |
| P3 | 桌面、机器级服务 | 普通权限 GUI；launchd 后台；不依赖登录；卸载保留配置 |
| P4 | 双架构安装与验收 | 原生 CI、签名/公证、实机指标对照、重启/离线/更新/回滚 |

实现入口：`agents/internal/macos`（原生桥接及纯函数语义测试）、
`agents/platform_macos.go`（指标投影/质量）、`service_darwin.go`（launchd）、
`macos-native.yml`（unsigned 验证）、`macos-signing.yml`（仅手动签名交付）。
静态与快速测试通过不代表上表全部完成；native CI、实机及签名证据须分别登记。
本地检查在本机无 `.git` scratch 快照运行，源码提交仍只从任务 worktree 产生。
在采集源拒绝权限、首帧无采样窗口、计数器重置或热插拔时，历史图表也保留缺口，
不把不可用或过期读数补成真实零值。网络汇总排除 loopback、VPN 与系统虚拟接口，
各接口自身计数仍保留以供诊断。

当前机器是 x86_64 PVE macOS 26.7.1 虚拟机。没有 IOAccelerator 节点；存在模拟
AppleSMC，不能据此验证物理温度/风扇。用户有 Intel Mac，暂不接入；暂无 Apple
Silicon 实机和 Developer ID 证书。CI/样本通过不等于物理硬件或正式分发通过。
**没有签名、公证和两类实机证据时，不得声称 P4 验收完成。**

## 现有指标语义矩阵

“按暴露”表示硬件、驱动或权限不支持时必须报告不可用，不填真实零值。

| 指标 | Darwin 来源/语义 | 差异及验收重点 |
| --- | --- | --- |
| cpuUsage | Mach/gopsutil CPU 时间差 | 空闲确实可以为 0；采样窗口明确 |
| cpuFrequency | IOReport 驻留时间加权、明确频率标签 | 不把 sysctl 标称频率或 DVFM 最大档当实时频率；Intel 按暴露 |
| cpuTemperature | AppleSMC TCAD（Intel 直读）；Apple Silicon 取 HID 片上簇/裸片监测点均值，再退回 SMC 温区均值 | 均值标为派生，不假冒逐核；未知键只列诊断 |
| cpuTopology | sysctl/gopsutil；`hw.perflevelN.*` 给出性能/能效集群核数与缓存，`hw.l2/l3cachesize` | 物理核/逻辑核不混淆；单一性能级别（Intel/虚拟机）不拆集群 |
| systemOverview | `proc_listallpids` + `proc_pidinfo` 线程数；句柄数取 `kern.num_files`（系统打开文件表） | Darwin 无 Windows 句柄表；非 root 时线程只计可读进程 |
| gpuUsage | IOKit PerformanceStatistics | 每块 GPU 独立；无计数器不能填 0 |
| gpuEncode | 驱动显式计数器 | 按暴露，不用总利用率替代 |
| gpuDecode | 驱动显式计数器 | 按暴露，不用总利用率替代 |
| gpuFrequency | 驱动 Core Clock；Apple Silicon 取 IOReport `GPU Performance States` 驻留加权 + pmgr `voltage-states9` 表 | 活跃档数与频率表长度不一致即不可用 |
| gpuMemory | 驱动内存计数 | Apple unified / Intel shared 与独显 dedicated 区分；系统 RAM 不是 VRAM |
| gpuTemperature | 驱动温度；Apple Silicon 取 HID `GPU MTR` 监测点均值 | 不能用 CPU 温度替代 GPU 温度 |
| gpuDriverInfo | 驱动显式版本 | 内核/系统版本不是驱动版本 |
| temperatureSources | SMC 键及来源、置信度 | 保留原始键；异常值和诊断键不作主温度 |
| memoryUsage | Mach VM statistics64 | 已用 = 内部应用页 - 可清除页 + wired + 物理压缩页 |
| swapUsage | sysctl vm.swapusage | 当前未分配 swap 仍是有效 0 |
| memoryAvailable | 总量减上述已用 | 派生可回收估计，不宣称 Linux MemAvailable |
| memoryCached | 外部文件页 + 可清除页 | 保留口径，不与压缩逻辑页相加 |
| memoryCommitted | 不适用 | Darwin 无等价 Windows commit limit；不拿 RAM+swap 伪造 |
| memoryHardware | `system_profiler SPMemoryDataType`（按资产 TTL 缓存） | Intel 给频率/已插条数/类型；Apple Silicon 只有类型与厂商，形态记为 On-package，不伪造频率/槽数 |
| diskUsage | diskutil APFS 容器容量 | 多卷去重；隐藏辅助卷不重复统计；非 APFS 独立文件系统 |
| diskRead | IOKit/gopsutil 字节增量 | 物理盘与 APFS 容器/卷标识不能混用 |
| diskWrite | IOKit/gopsutil 字节增量 | 计数器重置、热插拔后的第一帧不产生尖峰 |
| diskMetadata | IOKit `Device Characteristics` / `Protocol Characteristics` | 映射 physical store 所在整盘；虚拟盘（APFS 合成盘、镜像）不计硬件 |
| diskActivity | IOBlockStorageDriver 累计耗时 ÷ 操作数 = 平均响应时间（派生） | 忙碌率无 Darwin 来源，不上报 |
| diskHealth | IOKit NVMe/ATA SMART 用户客户端（只读），缺失时退回 smartctl | 不把无法读取视作健康；USB 外接盘无 SAT 直通，不可用 |
| networkRxRate | gopsutil 计数器增量 | 排除 loopback，不随 VPN 重复相加 |
| networkTxRate | gopsutil 计数器增量 | 保留网卡实例、重置处理 |
| networkTraffic | gopsutil 累计计数 | 重启后累计口径明确 |
| networkIdentity | 接口地址；IONetworkController 链路速率/型号；SystemConfiguration 接口类型；CoreWLAN RSSI/噪声/PHY 速率 | 链路未激活不给速率；SSID/BSSID 受位置权限限制，从不读取 |
| fanRpm | SMC F<n>Ac | 0 RPM 可有效；无风扇机型不伪造风扇 |
| fanControl | SMC 明确模式只读 | 本期不写 SMC、不调整风扇 |
| fanTargetTemperature | 无通用等价键 | 不适用/按暴露，不由目标转速反推 |
| fanPwm | 无通用等价键 | 不用 RPM 比例假冒 PWM |
| fanChannelState | 实际读数/模式状态 | 按暴露 |
| fanNote | 现有用户备注 | 与平台无关，保留已有功能 |

### 指标白名单之外的附加观测

以下字段不进入指标白名单与 `metricQuality`（旧 Hub 会严格拒收未知指标键，已有设备的指标选择也是显式列表），
而是作为可选顶层字段上报，没有来源时整段省略：

| 字段 | Darwin 来源 | 说明 |
| --- | --- | --- |
| `power` | IOReport `Energy Model`（CPU/GPU/ANE/DRAM/媒体引擎）+ AppleSMC `PSTR`/`PDTR`/`PCPC`/`PG0R` + 适配器额定功率 | 上一硬件窗口的平均瓦数；适配器功率是额定值不是读数 |
| `battery` | IOPowerSources + AppleSmartBattery | 电量、充放电、剩余时间、最大容量/设计容量、循环、温度、电压、电流（带符号） |
| `thermal` | `com.apple.system.thermalpressurelevel` | nominal/moderate/heavy/trapping/sleeping |
| `memory.compressedBytes` / `pressureLevel` / `memoryType` | Mach VM 压缩页、`kern.memorystatus_vm_pressure_level`、system_profiler | 压缩内存已包含在 usedBytes 内 |
| 实时进程磁盘读写（Hub revision 4） | `proc_pid_rusage` diskio 计数（Linux 为 `/proc/<pid>/io`） | Windows 无只计磁盘的进程计数，保持 null |
| 实时进程 GPU | IOAccelerator 用户客户端 `AppUsage.accumulatedGPUTime` 累计值，读不到时退回 powermetrics | 不再每周期起 powermetrics 子进程 |

### 已修复的既有缺陷（macOS 采集扩展）

- `guanlan_hardware` 把 `AppleSilicon` 装箱成数字，Go 以 bool 解码失败，导致 SMC 温度/风扇、IOKit GPU、IOReport 频率在所有 Mac 上整体缺失。
- `diskutil apfs list -plist` 不含挂载点，APFS 容器全部被丢弃，Mac 磁盘列表恒为空（桌面端探测同样为空）；现以 getfsstat 解析挂载点，系统卷只读快照计入其卷。

### 当前保守降级

- Intel 实时频率仅在 IOReport 明确提供频率标签时可用；不使用退役驱动或标称频率顶替。
- Apple Silicon DVFM 只接受已知 cluster/property 和完整一一对应的 V-state 表；新芯片映射不符时不可用。
- Apple SMC CPU 温区平均值标为派生，不标为真实封装/逐核读数；SMC 未映射键保留诊断身份。
- GPU 编解码利用率与驱动版本仍不可用：没有公开或私有的利用率计数器，IOReport 只有媒体引擎能耗（已作为 `power.mediaWatts` 上报，不当作利用率）。
- Wi-Fi SSID/BSSID 在 macOS 14+ 需要定位权限，LaunchDaemon 无法获得，不读取；信号强度按 RSSI -100 dBm→0%、-50 dBm→100% 线性换算。
- 风扇 PWM 与目标温度没有 SMC 等价键，保持不适用。
- 多 physical-store 容器不会错误地继承单盘 IO/健康数据；其逐盘合成尚待实施与实机验证。
- GUI 无机器配置权限时沿用只读服务模式，受限提权控制通道/SMAppService 尚待实现与签名条件验证。

上述为未完成项，不得将“不可用”降级等同于已经实现所有 Mac 字段或完全功能对齐。

## 签名配置（尚未提供，未触发）

受控 environment：`macos-signing`。变量：`MACOS_APPLICATION_IDENTITY`、
`MACOS_INSTALLER_IDENTITY`。secrets：`MACOS_APP_CERT_P12_BASE64`、
`MACOS_INSTALLER_CERT_P12_BASE64`、`MACOS_CERT_PASSWORD`、
`MACOS_NOTARY_KEY_P8_BASE64`、`MACOS_NOTARY_KEY_ID`、`MACOS_NOTARY_ISSUER`。
只配置到 GitHub environment，不能放进仓库、日志或对话。手动 workflow 仅接受 main，
暂存证书到临时钥匙串，生成签名、公证、staple 验证的 app/完整 pkg；仅上传 Actions
artifact，不自动发布 Release。无人配置时不触发、不声称签名链已通过。

参考语义与公开接口：Apple Mach/IOKit/ServiceManagement 文档、
[Stats](https://github.com/exelban/stats) 与 [mactop](https://github.com/metaspartan/mactop)
的公开 SMC/IOReport 说明（MIT）。桥接代码独立实现，不包含风扇写入 API。

## 安全与交付边界

- `/Library/Application Support/Guanlan` 为机器配置根，凭据 owner-only；GUI 无权时使用既有只读服务模式。
- launchd 使用 system LaunchDaemon；程序参数是 plist 数组，不拼接 shell 命令。
- 服务程序随完整安装单元落到 root-owned `/Library/PrivilegedHelperTools/Guanlan`，不从 admin-group 可写的 `/Applications` 路径以 root 执行。
- 不从 renderer 接收任意提权命令；不自动要求 root 运行 GUI，不写 SMC。
- 更新必须替换完整、已校验的签名安装单元，不单独修改 `.app` 内二进制。
- 无证书时 CI 仅产出明确标注 unsigned 的验证资产，不发布为正式安装源。
- 正式安装包需 Application/Installer 签名、notarytool 公证及 stapler 验证，失败闭合。

## 实机验收清单（均需提交证据，未勾选不算通过）

- [ ] Intel Mac：机型/系统/权限、空闲与负载下 CPU/GPU/SMC/SMART 对照。
- [ ] Apple Silicon Mac：同上；统一内存、大小核与动态频率对照。
- [ ] 无风扇、外接显示器、多 GPU、APFS 多卷与多 physical store。
- [ ] 普通用户/拒绝权限、睡眠唤醒、计数器重置、热插拔。
- [ ] GUI 退出仍采集、未登录启动、重启自恢复、停止/卸载后配置保留。
- [ ] Hub 断线缓存及恢复上传；配置/指标选择/备注/图表与其他平台对齐。
- [ ] 双架构签名、公证、全新安装、升级失败回滚、Gatekeeper 离线检查。
