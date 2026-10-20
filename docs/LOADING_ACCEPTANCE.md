# 联合加载验收记录

## 结论边界

阶段 1–6 已通过 PR #74–#80 串行集成。阶段 7 增加固定弱网与生产态浏览器联合验收；
**生产浏览器行为验收通过，但冷 Web 摘要未达 3 秒预算；真实国内公网/代表原生设备验收仍未完成。**
本任务没有发布、部署或改变 NAS/VPS/Cloudflare 入口，不能宣称线上已经变快。

已确认的改进是：摘要/缓存不再受可选读取阻塞、身份/取消边界有行为回归，
以及同口径 First Load JS 从 213 kB 降到 137 kB（约 36%）；不等于加载时间减少 36%。
原始查询、包体与未部署风险见 [LOADING_PERFORMANCE.md](LOADING_PERFORMANCE.md)。

## 自动化证据

| 层级 | 实际覆盖 | 不代表什么 |
| --- | --- | --- |
| 服务端 | MySQL 8.4 旧/新查询等价、半开范围/投影/索引与序列采样契约 | 未向生产应用 DDL；夹具不代表生产 API 耗时 |
| Web/PWA | 实际 HTTP、生产 Chromium/WebKit、Worker 离线设备深链/更新/拒绝访问/缓存清理 | 非真实穿透及运营商丢包 |
| 桌面 | 实际 Controller/HubClient/文件缓存、dist 性能断言、Electron 视觉及跨平台包 | 非代表设备进程冷启动 P75 |
| Android | 实际 MainViewModel Robolectric、协程认证/取消、文件缓存、编译/测试/lint | 无实机 Keystore 迁移/断电与 Perfetto 冷启动数据 |
| 阶段 7 浏览器 | 20 独立冷 Web、20 独立已安装 PWA 重启、30/100 设备功能夹具全部通过 | 非 20 个全新浏览器进程，无 CPU 降速，无真实数据库 |

阶段 6 最近证据：

- 桌面：[CI 39443625935](https://github.com/IGNGserver/guanlan-monitor/actions/runs/39443625935) 全绿，
  含 verify、Electron/Web 视觉、Linux/Windows 打包；
  [macOS 39443625873](https://github.com/IGNGserver/guanlan-monitor/actions/runs/39443625873) 双架构全绿，
  [MySQL 39443625854](https://github.com/IGNGserver/guanlan-monitor/actions/runs/39443625854) 通过。
- Android：[CI 39448861926](https://github.com/IGNGserver/guanlan-monitor/actions/runs/39448861926) 全绿，
  Android job 6m13s，真实执行 assembleDebug/testDebugUnitTest/lintDebug；
  前一轮新测试泛型调用编译错误已按日志修复，没有删测试或绕过检查。

## 阶段 7 采样与命令

在 CI runner 或已有运行服务的本地 scratch，**不要为此在 NAS 源码卷装依赖或产出构建**：

```sh
pnpm test:loading-performance
# CI 复用 web-visual job 中已经运行的生产 Web 与隔离 Playwright：
NODE_PATH="$RUNNER_TEMP/dsc-playwright/node_modules" \
  node scripts/loading-acceptance.cjs http://127.0.0.1:3000 "$RUNNER_TEMP/dsc-visual/loading"
```

脚本只接受无凭据、无 query 的本机 HTTP origin。夹具与限速入口只监听 loopback，
不登录真实 Hub，不导出 Cookie、设备正文、存储内容、响应头或 URL 查询。
JSON 仅输出固定检查说明、数字时序、统计与固定错误类别；随现有 web-visual artifact 留证。

- HTTP 入口共享下行 125000 B/s、上行 32000 B/s 和额外 300 ms 响应头延迟，
  限速包含 Service Worker 网络请求，不是给每个资源各分配 1 Mbps。
  body 按实际传递的编码字节节流；**不是** DNS/TLS、TCP 拥塞、丢包或精确 RTT 模拟。
- Web：20 次独立 context、禁用 SW、无本地缓存，3 设备固定夹具；总览/更新可选接口延迟 30 秒。
  摘要与可用导航必须先到，并验证单次会话探测。它是冷文档访问，不是冷进程。
- PWA：每次独立 context 先不受限速地安装 Worker、写真实 scoped IndexedDB 缓存，
  再启用限速并重启文档。会话请求悬挂，验证缓存先展示、可只读导航、管理不可用。
  不把无网可见的缓存视图当有效在线会话摘要。
- 额外覆盖浏览器断网/恢复、无 Worker 负对照、迟到 401 清私有工作区及存储；
  30/100 设备仅功能检查，不混入 3 设备的百分位。
- User Timing 是 React effect commit，不是绘制；另记 FCP。
  interactiveMs 是观察到可用导航且摘要/缓存可见的上界，随后实际点击验证，**不是 INP**。
  Resource Timing 是该观察点前的导航与已完成资源编码字节/传输量，非全页面总下载。
- P50/P75 使用 nearest-rank；失败、缺字段、样本不足 20 全部标 incomplete，
  不用快速失败降低分位数。原始成功/失败数和每次样本都保留；不以 20 个样本报 P95。

## 预算与最终结果

| 项目 | P75 目标 | 当前证据 |
| --- | --- | --- |
| 已安装 PWA 缓存 commit | ≤ 1000 ms | **387.9 ms，达标**（20/20 成功） |
| 冷 Web 可用导航 + 摘要 | ≤ 6000 ms | **3861.1 ms，达标**（20/20 成功） |
| 冷 Web 有效会话摘要 commit（自导航起） | ≤ 3000 ms | **3823.9 ms，未达标**（20/20 成功；包括壳下载） |
| 原生缓存可见/摘要/系统冷启动 | 同原定预算，分端记录 | 没有实机分位数，不能验收 |

**行为正确性 gate 与观察性性能预算独立。**脚本对阻塞/身份/只读/离线回退错误返回失败；
CI 预算按固定阈值报告 pass/fail/incomplete，不因 runner 变化放宽目标，也不把“脚本退出 0”解释成预算全过。
没有优化前的同环境 20 样本，所以即使达标也不能计算启动秒数改善百分比。

### 实际 CI 测量（2026-10-20 UTC）

代码提交 `03f860fe`，生产 Chromium `140.0.7339.16`；
[CI 39452367530](https://github.com/IGNGserver/guanlan-monitor/actions/runs/39452367530) 全绿，
墙钟 7m46s，其中 Web visual regression smoke 6m18s（含本节采样及既有 Chromium/WebKit PWA/视觉流程）。
同提交 [macOS 39452367541](https://github.com/IGNGserver/guanlan-monitor/actions/runs/39452367541) 全绿，墙钟 4m55s。
原始 `loading/loading-acceptance.json` 在该 run 的 `web-visual-regression-*` artifact 中，包含 40 次数值样本与失败计数。
构建/生产态采样全部在 CI；public 仓库，私仓月度分钟消耗 0。

| 场景 / 指标 | P50 | P75 |
| --- | --- | --- |
| 冷 Web 壳提交 | 3334.4 ms | 3335.9 ms |
| 冷 Web 摘要提交 | 3820.7 ms | 3823.9 ms |
| 冷 Web 交互观察上界 | 3858.7 ms | 3861.1 ms |
| 冷 Web FCP | 1140 ms | 1264 ms |
| PWA 缓存提交 | 386.6 ms | 387.9 ms |
| PWA 只读交互观察上界 | 409.6 ms | 411 ms |
| PWA FCP | 36 ms | 36 ms |

冷 Web 观察点前导航及已完成资源：编码 body P75 316829 B、transferSize 322529 B、18 个 resource entries。
PWA 相同观察口径：编码 body P75 947465 B、transferSize 0 B、16 个 entries；来自本机缓存的编码字节
**不等于网络下载**，会话还在悬挂，所以也不是完整网络流量或在线摘要时间。

20 次冷 Web 均在 30 秒可选读取完成前显示摘要/可用导航，每次一个会话探测；
20 次 PWA 均从 Worker 返回文档并恢复只读缓存。浏览器断网重启、无 Worker 负对照、
手动恢复、迟到 401 清工作区/IndexedDB 与 30/100 设备功能检查通过。

**仍未完成的性能目标：冷 Web 摘要 P75 ≤ 3 秒。**壳提交已约 3.34 秒，摘要随后约 0.49 秒；
此夹具下优先排查冷启动资源与模块启动，而不是再放宽可选接口等待或把缓存时间冒充在线摘要。
本任务没有同环境旧版分位数，不能量化相对改善；后续优化与真实线路/实机测量须保留这条缺口。

## 尚需真实环境验收

- 国内无代理的代表宽带/蜂窝链路：内网、beijing-vps2 与 Cloudflare，记录运营商、代理/TUN、
  客户端/Hub 版本与 20 次成功失败数；本机 fake-IP/TUN/SJC 基线不能代替。
- 明确发布/部署授权后才能测到新代码。当前生产仍是 507bde99 / 3.0.160；
  不能把同版本号 main 的变更当已安装产物，更不能用公网 HTTP 发送凭据。
- Android Macrobenchmark/Perfetto 与 Electron 系统进程冷启动；记录设备规格、电池/热状态、
  缓存新旧、前台恢复与完整用户交互。JVM/renderer 标记不能代替系统测量。
- 首次部署覆盖索引的 IO/启动成本、硬件安全存储迁移与磁盘失败/断电测试。

回退策略：标准模式回完整图表；缓存失效/存储拒绝回实时只读或连接错误；
服务端加性索引不需删，管理写不自动重放。将来发布回退必须使用上一固定版本产物，
目前没有新部署需要回滚。
