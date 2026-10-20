# 联合加载验收记录

## 结论边界

阶段 1–6 已通过 PR #74–#80 串行集成。阶段 7 增加固定弱网与生产态浏览器联合验收；
**生产浏览器测量待本 PR 的 CI，真实国内公网/代表原生设备验收仍未完成。**
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
| 阶段 7 浏览器 | 20 独立冷 Web、20 独立已安装 PWA 重启、30/100 设备功能夹具；待 CI | 非 20 个全新浏览器进程，无 CPU 降速，无真实数据库 |

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
| 已安装 PWA 缓存 commit | ≤ 1000 ms | 待阶段 7 CI 测量 |
| 冷 Web 可用导航 + 摘要 | ≤ 6000 ms | 待阶段 7 CI 测量 |
| 冷 Web 有效会话摘要 commit（自导航起） | ≤ 3000 ms | 待阶段 7 CI 测量；包含壳下载，可能不达标 |
| 原生缓存可见/摘要/系统冷启动 | 同原定预算，分端记录 | 没有实机分位数，不能验收 |

**行为正确性 gate 与观察性性能预算独立。**脚本对阻塞/身份/只读/离线回退错误返回失败；
CI 预算按固定阈值报告 pass/fail/incomplete，不因 runner 变化放宽目标，也不把“脚本退出 0”解释成预算全过。
没有优化前的同环境 20 样本，所以即使达标也不能计算启动秒数改善百分比。

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
