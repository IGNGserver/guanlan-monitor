# 设备状态控制台全仓库安全与架构审计

- 审计日期：2026-08-27
- 审计基线：`main` / `367b6aa` / `v0.2.285`
- 审计范围：当前 Git 跟踪的 Hub、Web、Electron、Go Agent/CLI/本地后端、Android、iOS、旧 WinUI/GTK、构建发布与部署脚本，以及相关项目内文档和 Git 历史。
- 本轮约束：只审计，不修改业务代码；未使用 Memory 或其他聊天记录；按仓库要求未在本机执行 pnpm、Go、Gradle、Docker、打包或部署。

## 1. 结论摘要

当前代码库的主要风险不是某一个孤立的输入校验错误，而是信任模型本身没有区分“采集 Agent”“普通查看者”和“Hub 管理员”。同一个 `ACCESS_KEY` 同时承担设备上报、浏览器/桌面/移动端登录和管理操作权限；任意一台 Agent 主机泄露凭据，就等价于整个 Hub 的管理权限泄露。在这个前提下，匿名 Socket.IO 又绕过了 REST 会话边界，把完整实时遥测公开给任何能连接 WebSocket 的客户端。

确认的最高优先级问题：

1. **P0：Socket.IO 未认证即广播完整实时 Agent payload**，包括 IP/MAC、硬件、传感器和虚拟化清单。
2. **P0：单一全局密钥合并 Agent 与管理员权限**，无法隔离单设备失陷，也无法证明上报的设备身份。
3. **P1：Android 正式构建允许任意公网 HTTP**，登录时会通过明文链路发送上述全局管理密钥。
4. **P1：设备删除语义已失效**；非虚拟机设备会被残留实时或历史数据在下一次列表查询时重新注册为 `open`。
5. **P1：本地 JSON 存储会把任意读取错误当作空库，下一次写入可覆盖原数据；一次写失败还会永久毒化写队列，直到进程重启。**
6. **P1：历史聚合只存在内存且没有关机冲刷，MySQL 保留清理只在启动时运行，后台离线扫描异常也没有捕获。**
7. **P1：生产工作流允许把 prerelease 以 `stable` 通道部署；仓库没有一条完成“正式 Release 晋级 + 固定签名 + 稳定通道”的闭环。**
8. **P1：Windows 安装器静默执行仓库内的第三方内核驱动安装程序，但 CI 不校验其预期哈希、签名或来源。**

本次还确认了多条“内部仍完整互相引用，但产品入口已经不存在”的遗留链：风扇备注写入链、Hub 自更新链、旧 WinUI/GTK 构建验收链、已从发布流程删除的 iOS 客户端、被强制保留但排除在构建外的旧 Web Dashboard，以及不再打包的 Node Agent。它们不是简单的几个未使用符号，而是会持续扩大权限面、CI 成本、维护成本和错误信心的完整子系统。

## 2. 当前真实架构与信任边界

当前交付主线为：

```text
Go Agent / CLI / Electron 内置 Agent
       | Bearer ACCESS_KEY
       v
Fastify Hub ---- Redis 实时态
       |       \ MySQL 历史/设备/布局
       |       \ local-db.json 备注/记录项配置及降级存储
       |
       +-- Cookie 会话 REST API -- Web / Electron / Android / iOS
       |
       +-- Socket.IO device:update -- Web（当前未认证）
```

产品桌面主线已经是 `apps/desktop` 的 Electron 客户端；测试版 Release 生成 Electron Windows/Linux GUI、CLI 和 Android 资产（`.github/workflows/release-test.yml:126-143,219-279,371-390,430-455`）。旧 `windows-agent` WinUI 和 `linux-agent-gui` 不在当前 Release 资产中，但仍由普通 CI 完整构建和验收（`.github/workflows/ci.yml:76-163`）。Web 生产路由只进入 `UnifiedConsole`（`apps/web/src/app/page.tsx:1-5`、`apps/web/src/app/devices/[deviceId]/page.tsx:1-5`）。

本架构目前隐含了三个未经代码强制的假设：

- 每一台 Agent 都与 Hub 管理员同等可信；
- Hub 永远单实例运行；
- `local-db.json` 永远可读、可写且不会损坏。

下面的多项问题都源自这些假设。

## 3. 已确认的安全问题

### F-01 [P0 / Critical] 匿名 Socket.IO 暴露完整实时遥测

**状态：已确认，可由静态调用链直接证明。**

证据：

- REST 数据路由普遍使用 `requireAuth`，但 Socket.IO 初始化只有 `origin: true` 和 `credentials: true`，没有 `io.use(...)`、握手凭据校验或房间授权（`apps/server/src/index.ts:103-110`）。
- 每次 ingest 后，全局广播 `device:update`（`apps/server/src/index.ts:70-75`）。
- 广播对象的 `latest` 是完整 `AgentMetricsPayload`，不是最小摘要（`apps/server/src/services/metrics.ts:79-87`）。
- payload 包含网卡 MAC、IPv4/IPv6（`packages/shared/src/index.ts:207-217`），也可包含虚拟化节点、VM、存储与能力清单（`packages/shared/src/index.ts:452-464,574-597`）。
- Web 中间件公开转发 `/socket.io`（`apps/web/src/middleware.ts:7-26`），客户端连接时也不提供任何认证材料（`apps/web/src/lib/console-adapter.ts:144-151`）。

失败/攻击路径：攻击者只需连接公开 Web 主机的 `/socket.io`，监听 `device:update`；不需要知道 `ACCESS_KEY`，也不需要先取得 `dsc_session`。只要任意 Agent 下一次上报，就会收到完整实时数据。

建议：

1. 给 Socket.IO 增加与 REST 一致、可过期且可撤销的握手认证；拒绝无有效会话连接。
2. 默认只发送列表所需的最小 `summary`，设备详情由已授权 REST 按需读取；不要全局广播 `latest`。
3. 按用户/设备授权加入 room，而不是 `io.emit` 全局广播。
4. 增加三类集成测试：匿名连接必须失败、过期会话失败、授权客户端只收到其允许设备的数据。

### F-02 [P0 / Critical] 单一全局密钥合并 Agent、查看者和管理员权限

**状态：已确认，是设计级信任边界缺陷。**

证据：

- 配置明确写明 `ACCESS_KEY` 是所有客户端和 Agent 的统一凭据，旧 Agent 密钥即使不同也被忽略（`apps/server/src/config.ts:25-27,44-51`；`.env.example:1-3,29`）。
- Agent ingest 使用该值作 Bearer token（`apps/server/src/index.ts:85-99`）。
- 浏览器/客户端登录也直接比较同一个值（`apps/server/src/routes.ts:278-290`）。
- Agent 配置同步和设备状态接口同样使用该值，而且调用者可以在 body/query 中任选 `deviceId`（`apps/server/src/routes.ts:553-610`）。
- ingest 直接信任 `payload.identity.deviceId` 并注册该设备，没有将凭据绑定到设备身份（`apps/server/src/services/metrics.ts:47-50`）。
- 取得浏览器会话后可删除、重排设备、修改展示配置和请求 Hub 更新（`apps/server/src/routes.ts:262-276,376-398,531-550`）。

影响：任意一台 Agent 主机、旧客户端配置或传输链路泄露密钥，攻击者都可登录管理界面、读取全体设备、删除/重排设备、篡改记录项配置，且可以伪装成任意 `deviceId` 上报数据。无法只吊销一台设备，无法追责，也无法实施最小权限。

建议：

- 引入至少三类主体：Hub 管理员/查看者、Agent、部署自动化；使用不同凭据和权限集合。
- 每个 Agent 使用独立、可轮换、服务端仅存哈希的 token，并在服务端绑定固定 `deviceId`；禁止 payload 自己改变身份。
- 管理员使用独立账户或短期会话，关键写操作需要明确角色；部署 token 只允许触发固定 workflow/environment。
- 设计凭据版本、吊销、最后使用时间和审计日志；先支持双栈迁移，再废弃全局 Agent 密钥。

### F-03 [P1 / High] 登录会话无期限、不可随访问密钥轮换撤销，认证外围缺少基本约束

**状态：已确认。**

证据：

- 会话 cookie 内只有 `issuedAt`，但该值从不参与校验（`apps/server/src/types.ts:174-176`；`apps/server/src/routes.ts:889-913`）。
- cookie 没有 `maxAge`/`expires`；只要 `SESSION_SECRET` 不变，旧 cookie 在浏览器保留期间一直有效（`apps/server/src/routes.ts:889-896`）。因此单独轮换 `ACCESS_KEY` 不会撤销已经签发的会话。
- `SESSION_SECRET` 只要求 8 字符、`ACCESS_KEY` 只要求非空（`apps/server/src/config.ts:25-27`），示例值是可直接复制的 `change-me-*`，`SESSION_COOKIE_SECURE` 默认关闭（`.env.example:1-4`）。生产启动没有拒绝这些占位值。
- 登录路由没有速率限制；仓库也没有 rate-limit 依赖或 hook。
- Fastify REST CORS 反射任意 Origin 且允许凭据（`apps/server/src/index.ts:28-33`）。`SameSite=Lax` 会阻止多数跨站 POST 自动携带 cookie，但任意 Origin 反射仍扩大同站子域、未来 cookie 策略变化和错误部署的攻击面。

建议：会话增加绝对过期、空闲过期、凭据版本/会话版本和服务端吊销；密钥轮换必须立即使旧会话失效。生产环境拒绝占位密钥和弱密钥，默认 `Secure`，登录限速并记录失败审计；CORS 使用显式 Origin 列表。若继续使用共享口令，至少用常量时间比较。

### F-04 [P1 / High] Agent ingest 只有 TypeScript 类型，没有运行时协议校验

**状态：已确认。**

证据：

- `/api/agent/ingest` 把 body 仅标注为 `AgentMetricsPayload` 后直接传入业务层，没有 Zod/JSON Schema 校验（`apps/server/src/index.ts:85-99`）。TypeScript 类型不会验证网络输入。
- 业务层立即解引用 `payload.identity.deviceId`（`apps/server/src/services/metrics.ts:47-50`），并将整个 payload 写入实时存储和广播（`apps/server/src/services/metrics.ts:59-87`）。
- 时间戳直接 `Date.parse(payload.timestamp)`；无效值会成为 `NaN`（`apps/server/src/utils.ts:253-255`），随后参与桶计算和数据库 `FROM_UNIXTIME`（`apps/server/src/services/metrics.ts:219-247`；`apps/server/src/repositories/history.ts:130-187`）。
- 多个数组、字符串、数值范围和嵌套虚拟化清单均无协议级上限或合法范围校验。

影响：持有 Agent 凭据的客户端可制造 500、部分写入、非法时间桶、异常百分比或超大嵌套数据；结合 F-02 还可伪造任何设备和虚拟化清单。由于实时态先写、聚合后写，失败可能留下非事务性的半成功状态。

建议：为 ingest 建立严格、版本化的运行时 schema；限制 ID/hostname 长度与字符集、数组条目数、时间偏差、数值有限性和合理范围；拒绝未知/过期协议版本。验证成功后再开始任何写入，并按 sample ID 实现幂等。给恶意/损坏 payload 建立回归测试。

### F-05 [P1 / High] Android 正式构建允许任意公网 HTTP 发送全局管理密钥

**状态：已确认，当前交付链受影响。**

证据：

- Android `release` 明确设置 `usesCleartextTraffic=true`（`android/app/build.gradle.kts:69-76`），Manifest 使用该占位值（`android/app/src/main/AndroidManifest.xml:7-14`）。
- URL 策略对任意 `http`/`https` 主机放行，缺省协议自动补 `http://`（`android/app/src/main/java/com/dsc/android/data.kt:109-127`）。
- 单元测试显式要求 `http://hub.example.com` 被接受，而不只限私网（`android/app/src/test/java/com/dsc/android/ServerUrlPolicyTest.kt:16-25`）。
- 登录把 `accessKey` 放在 JSON body 发送（`android/app/src/main/java/com/dsc/android/data.kt:41-49`）。该 key 依据 F-02 同时是 Agent 与管理员凭据。

Android 使用 `EncryptedSharedPreferences` 保存凭据是正确控制（`android/app/src/main/java/com/dsc/android/data.kt:133-145`），但无法弥补传输明文。更新下载虽校验 SHA-256（`android/app/src/main/java/com/dsc/android/MainViewModel.kt:280-329`），若更新元数据和校验值也来自同一个被中间人控制的 HTTP Hub，哈希并不是独立信任根。

建议：Release 构建默认彻底禁用 cleartext；公网强制 HTTPS。若产品必须支持隔离 LAN 的 HTTP，应使用 Network Security Config 只允许明确的私网目标并显示强警告，且该模式绝不能复用管理员密钥。统一 Android、Electron、Go Agent 已有的公网 HTTPS 策略。

### F-06 [P1 / High] 默认 Compose 暴露 Redis/MySQL 管理端口且 Redis 无认证

**状态：已确认；实际可达性仍取决于宿主机防火墙。**

证据：

- Redis 映射 `${REDIS_PORT:-6379}:6379` 到宿主机所有接口，并只启用 AOF，没有认证配置（`docker-compose.yml:4-16`）。
- MySQL 同样映射 `${MYSQL_PORT:-3306}:3306`（`docker-compose.yml:18-35`）。Hub 本身通过 Docker 内网访问二者，因此这两个宿主机发布端口不是应用运行所必需。
- `.env.example` 提供可复制的占位数据库密码，并默认暴露端口（`.env.example:7-14`）。

建议：默认删除两个 `ports`，只保留 Docker 内部网络；确需宿主机调试时绑定 `127.0.0.1` 并通过独立 override 开启。Redis 启用 ACL/密码，数据库使用最小权限账户；生产启动验证占位密码已替换。

### F-07 [P1 / High] Windows 安装器静默执行未被 CI 锚定验证的第三方内核驱动安装程序

**状态：已确认。**

证据：

- 当前 Electron 配置明确 include 该 NSIS 脚本（`apps/desktop/package.json:70-80`），安装脚本会执行 `PawnIO_setup.exe -install -silent`，只 `Pop` 退出码而不判断成功/签名（`apps/desktop/build/installer.nsh:105-116`）；旧 Inno 链也执行同一文件（`deploy/windows-agent-setup.iss:71-74`）。
- Release 将整个 `agents/windows-hardware` 目录直接复制到交付物（`.github/workflows/release-test.yml:113-124`）。
- 仓库跟踪约 38 个 DLL 和该 EXE。`PawnIO_setup.exe.sha256` 当前与文件实际 SHA-256 一致，但 Release/CI 没有读取 sidecar 并阻断哈希不匹配；sidecar 与二进制也处于同一可修改信任域。
- 未发现 Authenticode 验证、固定上游版本清单、SBOM 或来源证明。

影响：任何能修改仓库或构建上下文的人都可替换高权限安装程序并同步修改 sidecar；正常 Release 会将其复制并在用户机器上静默提权执行。产物自身哈希只证明下载未变化，不能证明组件来源可信。

建议：建立第三方组件锁定清单（上游项目、版本、下载 URL、独立固定哈希、许可证）；CI 从受控来源获取并用仓库审查过的固定哈希验证，随后验证 Authenticode 发布者。Windows GUI/安装器也应签名；生成 SBOM 和构建来源证明。驱动安装应有清晰用户提示、退出码验证和可审计日志。

## 4. 已确认的功能正确性与可靠性问题

### F-08 [P1 / High] “删除设备”会被实时或历史数据立即复活

**状态：已确认，控制流闭环成立。**

证据：

- 删除虚拟机时会调用 `metricsService.removeDevice`，但普通设备只把 registry 状态改为 `closed`（`apps/server/src/routes.ts:376-384`）。
- MySQL 和 local repository 的删除都只是将状态改成 `closed`（`apps/server/src/repositories/devices.ts:73-78`；`apps/server/src/repositories/local.ts:400-405`）。
- 普通设备的 Redis/local realtime、短时序列和历史没有被删除。
- 下一次 `GET /api/devices`/`instances` 构造列表时，如果实时数据里存在未注册设备，会调用 `registerOrUpdateDevice`；即使没有实时态，只要历史里仍有该 ID，也会再次调用（`apps/server/src/routes.ts:620-649`）。
- `registerOrUpdateDevice` 对已有记录无条件把状态改回 `open`（`apps/server/src/repositories/devices.ts:20-42`；`apps/server/src/repositories/local.ts:362-387`）。

因此，不需要 Agent 再上报；用户删除后只要刷新列表，残留实时或历史记录就足以让设备恢复。UI、Android 和 iOS 都仍公开删除功能，属于产品功能失效而非边缘竞态。

建议：先定义语义：

- 若是“隐藏/退役”，建立 tombstone，列表重建必须尊重 tombstone；只有新的、绑定该设备的 Agent 凭据显式重新注册才能恢复。
- 若是“硬删除”，在一个业务事务中清除 registry、realtime、短期序列、历史、备注、记录项配置和布局引用，并发出一次 removal 事件。

无论选择哪种语义，都需增加“删除后连续刷新不复活”“新上报是否允许恢复”“删除 VM 与物理机一致性”测试。

### F-09 [P1 / High] local-db.json 读取失败会被当作空库，写队列一次失败后永久失效

**状态：已确认。**

证据：

- `LocalJsonStore.read()` 捕获所有异常并返回 `EMPTY_DB`，无法区分文件不存在、权限错误、I/O 错误或 JSON 损坏（`apps/server/src/repositories/local.ts:78-92`）。
- 下一次 update 会基于这个“空库”写临时文件并 rename 覆盖原路径（`apps/server/src/repositories/local.ts:95-107`），因此一次短暂读取错误或损坏可转化为持久数据丢失。
- `writeQueue = writeQueue.then(...)` 没有 rejection 恢复分支（`apps/server/src/repositories/local.ts:95-109`）。任何一次写失败都会使 promise 链保持 rejected，之后所有 update 都立即失败，直到 Hub 重启。
- 即使配置了 MySQL，风扇备注和设备记录项配置仍固定使用这个 local store（`apps/server/src/index.ts:36-40`）；它不是纯开发降级路径。
- 每次 mutation 都读取并重新序列化整份 JSON。降级到 local history 时，每次 ingest 会触发多次全库写；分钟历史每设备最多约 129,600 点，而小时历史没有写入上限（`apps/server/src/repositories/local.ts:165-193`）。

建议：生产环境对损坏/权限错误 fail closed，并把损坏文件隔离为带时间戳的副本；只把 `ENOENT` 当作空库。写队列应在记录错误后恢复接收后续操作。生产必需状态迁移到 MySQL/Redis 或专用事务型存储；若保留 JSON，使用明确 schema/version、文件锁、fsync、容量上限和故障注入测试。

### F-10 [P1 / High] 历史保留与聚合在长运行、重启和低频设备场景下丢数据/无限增长

**状态：已确认。**

证据：

- 分钟、小时 accumulator 只存在进程内 Map（`apps/server/src/services/metrics.ts:37-40`）。
- 当前桶只在收到下一个桶的样本时写入持久历史（`apps/server/src/services/metrics.ts:219-247`）。服务退出、崩溃、设备离线或长期没有下一样本时，最后一个分钟/小时桶不会持久化。
- Server 没有 SIGTERM/SIGINT/onClose 冲刷；唯一周期任务是离线扫描（`apps/server/src/index.ts:112-116`）。
- MySQL 的 90/370 天清理只在 repository `init()` 中执行一次（`apps/server/src/repositories/history.ts:15-16,21-24,104,113-128`）；长时间不重启的 Hub 会持续累积过期数据。
- local 小时历史没有裁剪（`apps/server/src/repositories/local.ts:182-193`）。
- `setInterval` 中把 `markOfflineDevices()` 作为未捕获的 void promise 调用（`apps/server/src/index.ts:112-114`）；Redis/MySQL 暂时异常可形成 unhandled rejection，且没有退避或健康降级。

建议：将聚合状态持久化或用可幂等重算的时间桶表；周期性冲刷当前桶，关机前完成有时限的 flush。保留策略用受监控的周期 job/数据库分区执行。周期任务必须捕获、记录并按退避重试；增加重启、最后一桶、数据库暂时断开和运行超过保留期的测试。

### F-11 [P2 / Medium] Agent 离线队列会把旧 Hub 的样本迁移到新 Hub

**状态：已确认，是显式实现但缺少租户/目的地边界。**

每条 pending sample 保存原 `ServerURL`（`agents/main.go:498-503,612-617`），但 replay 优先使用当前配置的 Hub，并重写 entry 的 URL（`agents/main.go:722-742`）。这解决了旧地址永久阻塞队列的问题，却意味着用户把设备从 Hub A 改到 Hub B 后，A 期间积压的硬件、网络和虚拟化遥测会使用 B 的新凭据上传到 B。

建议：在配置切换时明确询问“迁移/清空/保留旧队列”，默认不跨 Hub 发送；队列条目绑定目的地不可变标识而不是裸 URL。若支持迁移，应在 UI 中展示样本数量、原目的地和隐私影响，并记录审计事件。

### F-12 [P2 / Medium] Hub 实际上是单实例架构，但代码和部署契约没有显式限制

**状态：已确认。**

- Socket.IO 没有 Redis adapter；事件只会发到接收 ingest 的进程（`apps/server/src/index.ts:70-75,103-110`）。
- 聚合 accumulator 是进程内状态（`apps/server/src/services/metrics.ts:37-40`）。
- Hub 更新状态是模块全局内存变量（`apps/server/src/hub-update.ts:5-13`）。
- 记录项配置和风扇备注即使在 MySQL 模式仍落到本机 JSON（`apps/server/src/index.ts:36-40`）。

如果未来在反向代理后启动两个副本，WebSocket 客户端会漏事件，聚合桶会分裂，备注/配置因请求落点不同而不一致。建议要么在部署与启动时显式声明、检测并强制单副本，要么把全部共享状态和 Socket adapter 移到 Redis/MySQL，配合 leader/分布式锁处理周期任务。

## 5. 已确认的遗留与无效功能链

### L-01 [P2] 风扇备注：客户端功能已删除，但完整写入链仍在运行时接口中

**这是本次最明确的“代码内部仍互相引用，但产品功能已经不存在”的链。**

Git 提交 `b6ebf0de6ccc959594399e0010d8ff9946aa604a`（2026-08-24，`remove fan note cards from clients`）从当前 shared workspace 和 Android 删除了编辑器、状态和显示。当前界面只显示风扇 RPM/控制信息（`packages/console-ui/src/workspace/WorkspaceApp.tsx:2010-2019`；`android/app/src/main/java/com/dsc/android/ui/AppRoot.kt:1981-2043`）。

但下列完整链仍存在：

```text
DeviceMetricKey fanNote / Agent 过滤
  -> ConsoleFleetPort.saveFanNote
  -> WorkspaceContext.saveFanNote（当前无 UI 调用）
  -> WebConsoleAdapter / Web API
  -> Electron renderer bridge
  -> preload IPC
  -> main IPC
  -> DesktopController / HubClient
  -> PUT /api/devices/:deviceId/fans/:fanId/note
  -> LocalFanNoteStore(local-db.json)
  -> metrics GET 再合并到 fans[].note
```

证据包括 `packages/shared/src/index.ts:72-84,1131-1135,1198-1200`、`packages/console-ui/src/services/ports.ts:28-35`、`packages/console-ui/src/workspace/WorkspaceContext.tsx:565-573,680-685`、`apps/web/src/lib/console-adapter.ts:78-80`、`apps/desktop/src/main/ipc.ts:39-42`、`apps/desktop/src/preload/index.ts:27-30`、`apps/desktop/src/main/controller.ts:273-277`、`apps/server/src/routes.ts:418-420,479-482,508-515` 和 `apps/server/src/repositories/local.ts:257-270`。

该链继续扩大远程写权限、IPC 面、共享接口和本地存储风险，还让 Agent/CLI 继续暴露一个不再可见的 `fanNote` 记录项。建议先确认是否需要数据导出；若产品决定已删除，就在一个版本内删除端到端链和文档，而不是只删 UI。

### L-02 [P1/P2] Hub 自更新：唯一 UI 调用者已归档，服务端状态机也无法完成

**状态：当前产品入口不可达；直接 API 仍可调用；实现自身会卡死。**

- 当前 `WorkspaceApp` 更新页只提供打开 Release 链接，没有“部署 Hub”动作（`packages/console-ui/src/workspace/WorkspaceApp.tsx:2530-2533`）。
- Web API 仍导出 `requestHubUpdate/getHubUpdateStatus`，但生产代码无调用；唯一调用者是被排除在路由和 tsconfig 外的 `apps/web/src/components/legacy/update-notice.tsx`。
- 服务端仍保留管理路由和 GitHub workflow dispatch（`apps/server/src/routes.ts:262-276`；`apps/server/src/hub-update.ts:16-75`）。
- 成功 dispatch 后状态永久停留在 `requested`。没有保存 workflow run ID、轮询、回调、超时或成功/失败更新；下一次不同版本请求会一直返回 `another_hub_update_is_in_progress`（`apps/server/src/hub-update.ts:24-27,69-75`），只有 Hub 进程重启才会重置。

建议做产品二选一：删除路由、GitHub token 配置、Web API 和状态类型；或恢复一条受保护的管理入口，并以 workflow run/deployment ID 驱动持久状态机，包含超时、失败、重试和最终部署版本验证。

### L-03 [P1（仍有旧安装时）/ P2（仅仓库负担）] 旧 WinUI/GTK 已退出 Release，但仍是完整 CI/验收子系统

**状态：已由当前 Release 图、CI 和迁移文档交叉确认。**

- 当前 Release 是 Electron Windows/Linux GUI（`.github/workflows/release-test.yml:126-143,219-279`）。
- 普通 CI 仍安装 GTK/WebKit 依赖并构建旧 GTK 包，也仍构建旧 WinUI portable bundle（`.github/workflows/ci.yml:76-163`）。
- 迁移文档明确说 `apps/desktop` 是新实现、旧 GTK/WinUI 是迁移/回滚系统（`docs/unified-desktop/current-architecture.md:3-14`；`docs/unified-desktop/migration-plan.md:28-36`），但 README 仍把旧 Windows 手册列为当前发布说明（`README.md:132-140`），`agents/README.md:137-143` 仍把旧 GTK 包写成推荐 Linux GUI，文档与交付事实冲突。
- 规模不是可忽略的少量兼容代码：旧 WinUI 约 8,308 行、GTK 主文件 1,234 行，另有 31 个 `deploy/*windows-agent*` 构建/验收文件。
- Electron 包仍从旧 WinUI 目录读取图标（`apps/desktop/package.json:57-64`），形成删除障碍。

旧链还保留了现行主线已修复的本地安全问题：

- backend 默认固定监听 `127.0.0.1:17891` 且 token 为空时全部授权（`agents/cmd/windows-agent-backend/main.go:283-290,695-722`）；状态响应包含完整配置，包括 Hub 全局密钥（`agents/cmd/windows-agent-backend/main.go:594-637`）。
- 现行 Electron 和 CLI 已使用随机端口、随机 token、0600 token 文件（`apps/desktop/src/main/agent-manager.ts:23-26,45-65,158-169`；`agents/cmd/dsc/main.go:1533-1559,1636`），但旧 WinUI 启动 backend 不传 token，API client 也不带 token（`windows-agent/DeviceStateConsoleAgent.WinUI/Services/BackendHostService.cs:82-117`；`windows-agent/DeviceStateConsoleAgent.WinUI/Services/BackendApiClient.cs:14-49`）。
- GTK 的 systemd unit/fallback 同样不传 token，HTTP 请求不带 token（`linux-agent-gui/assets/device-state-console-agent-backend.service:6-9`；`linux-agent-gui/src/main.c:708-729,812-831`）。
- GTK WebKit 在任意配置的 `http://`/`https://` 页面加载完成后注入全局密钥登录脚本，没有最终 Origin 固定或重定向检查（`linux-agent-gui/src/main.c:911-954`）。
- WinUI WebView2 也在导航完成后向当前页面注入密钥登录脚本，未注册导航/新窗口 allowlist，也未核对重定向后的 Origin（`windows-agent/DeviceStateConsoleAgent.WinUI/MainWindow.xaml.cs:436-486,494-515`）。

只要旧客户端仍在用户机器上，这些不是纯历史问题：同机进程可读写 backend API，固定端口的简单 POST 也缺少 Origin/CSRF 防护。建议确定旧安装基数和退役日期；如果不再支持，移除 CI job/发布脚本，保留迁移读取和卸载兼容即可。若必须支持，先反向移植随机 token、动态端口、Origin 检查和 WebView 导航 allowlist。

### L-04 [P1（曾分发仍使用时）/ P2] iOS 客户端已从发布流程删除，但代码、更新协议和不安全凭据处理仍保留

**状态：Git 历史明确确认发布能力已删除。**

- 提交 `c7204d7e906b67ae95dae9791670efc79ea66b1a` 明确删除 iOS release job 和 IPA 资产；当前没有 iOS CI/build/release job。
- SwiftUI 客户端和约 2,902 行 iOS 工程仍在仓库，Hub `/api/updates` 仍接受 `ios` 并生成 store 更新结果（`apps/server/src/routes.ts:210-223`；`apps/server/src/updates.ts:127-131,200-217`）。
- iOS 版本硬编码停在 `0.2.68`，而根版本是 `0.2.285`（`ios/DeviceStateConsole/Info.plist:17-20`；`ios/DeviceStateConsole.xcodeproj/project.pbxproj:163,186`）；版本一致性脚本不检查 iOS（`scripts/verify-version.mjs:7-16`）。
- App Transport Security 全局允许任意加载（`ios/DeviceStateConsole/Info.plist:25-29`），缺省协议为 HTTP（`ios/DeviceStateConsole/ApiClient.swift:16-27`），全局管理密钥明文存入 `UserDefaults`（`ios/DeviceStateConsole/AppViewModel.swift:49-66`）。

建议明确标记 unsupported 并删除更新协议/源码，或恢复正式的签名、Keychain、HTTPS policy、版本同步、CI 和 TestFlight/App Store 交付；不应维持目前“API 看似支持、实际上无法构建发布”的状态。

### L-05 [P2] 旧 Web Dashboard 被刻意保留并由检查脚本强制存在

`apps/web/src/components/legacy` 约 3,507 行，目录文档明确说它不在生产路由（`apps/web/src/components/legacy/README.md:1-8`），`apps/web/tsconfig.json:25-34` 也将其排除。更反常的是 `scripts/check-web-ui-boundary.mjs:13-24,87-103` 不仅防止旧组件进入路由，还会在这些归档文件被删除时让检查失败。

这使 Git 历史本可承担的回滚职责变成永久维护的源码副本；旧 Dashboard 仍引用风扇备注、Hub 自更新和旧 metric config API，容易在搜索、重构和安全评估中制造假调用链。建议把回滚基线交给 tag/分支或单独只读归档，不要让主线 CI 强制死代码存在。

### L-06 [P3] 旧 Node Agent 和孤立类型属于已声明但未设置退出条件的历史兼容

- `agents/legacy/node-agent.mjs` 约 2,556 行；当前仓库除 `agents/README.md:137-143` 外没有启动、打包或 workflow 引用。文档明确说只为历史开发机兼容、不是推荐路径。
- `DeviceViewerPresencePayload` 只剩定义（`apps/server/src/types.ts:220-223`），没有当前路由、Socket 处理或调用者；Git 历史显示来自早期 viewer presence 功能。

建议为兼容代码记录仍支持的真实安装基数、负责人和删除日期；若没有调用方，直接依赖 Git 历史而不是继续留在主线。

## 6. 发布、部署与供应链问题

### F-13 [P1 / High] `stable` 部署没有绑定正式 Release，prerelease 可被当作稳定版部署

**状态：已确认。**

- 任意 `v*.*.*` tag 都触发测试 Release，且固定 `prerelease: true`（`.github/workflows/release-test.yml:3-7,449-455`）。
- 同一个 tag 自动触发 Docker publish；tag 事件默认嵌入 `test` 通道（`.github/workflows/docker-publish.yml:3-7,33-35,59-67`）。
- 生产 workflow 允许人工选择 `stable`，只验证 Release 不是 draft，没有验证 `.prerelease == false`（`.github/workflows/deploy-production.yml:4-17,43-56`）。因此任何测试 prerelease 都可被以 `DSC_RELEASE_CHANNEL=stable` 部署。
- Docker publish 的手工入口也允许选择 `stable`/`publish_latest` 和任意 ref，只校验 ref 中 `VERSION` 与输入一致，没有要求正式 Release、受保护 tag 或上游 verify/release run 成功（`.github/workflows/docker-publish.yml:7-27,41-79`）。
- `stable` 部署默认把镜像源改成第三方镜像站 `ghcr.nju.edu.cn`，但前一步登录的是 `ghcr.io`；最终又只按可变 tag 校验镜像名称，没有校验 origin GHCR digest 或签名（`.github/workflows/deploy-production.yml:97-108,120-129,153-159`）。固定版本字符串并不等于固定内容。
- `version` 输入没有严格 semver 校验，随后进入 GitHub URL和远端单引号 shell 字符串（`.github/workflows/deploy-production.yml:32-60,110-129`）。即使触发者本身需要生产权限，也不应让“选择版本”的参数扩大成任意远端 shell 语法。
- `RELEASE.md:3-11` 明确区分测试版和正式版，但仓库没有创建/晋级非 prerelease、强制稳定签名并绑定镜像 digest 的 formal-release workflow。

建议新增唯一的正式晋级 workflow：只接受已成功完成测试 Release 的不可变、严格 semver tag；验证全部资产及签名；把 GitHub Release 晋级为 non-prerelease；从受信 origin registry 以镜像 digest 而非可覆盖 tag 部署；`stable` environment 只接受该晋级记录。生产部署必须检查 `prerelease=false`、目标 commit、镜像 provenance、签名和 digest。所有进入 URL/SSH 的输入继续使用参数化传递或严格 allowlist，不能靠 shell 引号承担验证。

### F-14 [P2 / Medium] 测试 APK 签名可能每次变化，Windows 资产未见代码签名闭环

- Android workflow 在签名 secrets 缺失或无效时现场生成临时 keystore，然后仍发布测试 APK（`.github/workflows/release-test.yml:303-353`）。两次不同临时证书签名的 APK 无法覆盖安装，测试更新链会随机失效。
- 当前 Windows Electron 打包没有 Authenticode 签名或发布后签名验证；生成 `.sha256` 只能检测下载变化，不能证明发布者身份（`.github/workflows/release-test.yml:126-143,418-447`）。

建议测试通道也使用固定、隔离的长期测试签名证书；缺失时让发布失败而不是换身份。正式通道必须使用受保护 environment 中的正式证书，并在 workflow 中验证签名主体和时间戳。

### F-15 [P2 / Medium] 构建依赖与 Actions 大量依赖可变引用，削弱可复现性

静态统计显示：

- workflow 中有 54 处 `uses: ...@vN`，0 处固定到 40 位 commit SHA。
- 有 7 处 `pnpm install --no-frozen-lockfile`，尽管仓库已有 `pnpm-lock.yaml`。
- Gradle wrapper 未配置 `distributionSha256Sum`（`android/gradle/wrapper/gradle-wrapper.properties:1-7`）。
- Docker/Compose 基础镜像使用可变 tag（`deploy/docker/server.Dockerfile:1-2`、`deploy/docker/web.Dockerfile:1-2`、`docker-compose.yml:5,19`）。

建议固定 Actions commit SHA，CI/Release 使用 `--frozen-lockfile`，固定 Gradle 分发哈希和容器 digest，并启用依赖更新机器人、SBOM、provenance/attestation 与最小 workflow permissions。

### F-16 [P2 / Medium] 测试 Agent 部署首次信任 SSH 主机密钥

`.github/workflows/update-agents-test.yml:252-259,277-281` 使用 `StrictHostKeyChecking=accept-new` 对 root/部署账户更新 Agent 和修改集群配置。首次连接或 known_hosts 丢失时会无提示接受攻击者主机密钥；这是带 sudo/root 后果的 TOFU，而不是只读操作。

建议和 production 一样，把目标 host key/fingerprint 存入受保护 secret，运行前精确写入 `known_hosts`，禁止 fallback 到 accept-new。目标列表应同时绑定期望 host key，主机变更需人工审批。

## 7. 安全加固与测试缺口

### F-17 [P2 / Medium] Electron IPC 与导航缺少第二层来源校验

当前 Electron 已正确启用 `contextIsolation`、关闭 `nodeIntegration`，并有较严格 renderer CSP（`apps/desktop/src/main/main.ts:307-331`；`apps/desktop/index.html:7-10`），这是正向控制。

但 preload 暴露了 Agent 控制、凭据保存、删除、布局写入和退出等完整能力（`apps/desktop/src/preload/index.ts:16-47`），IPC handler 不验证 `event.senderFrame.url`/所属 BrowserWindow（`apps/desktop/src/main/ipc.ts:29-83`）；窗口 `sandbox: false`，也未找到 `will-navigate` 或 `setWindowOpenHandler` 拒绝策略。当前 renderer 只加载本地资源，尚未发现直接远程导航/XSS 利用链，因此评为 P2 防御纵深缺口，而不是已证实 RCE。

建议：所有敏感 IPC 统一验证 sender 与允许的本地 Origin；默认拒绝导航、新窗口和非预期 webContents；评估把 preload 改为可 sandbox 的格式。继续保留 CSP，并给 IPC 来源拒绝添加测试。

### F-18 [P2 / Medium] Web 缺少安全响应头，服务端安全关键路径几乎没有测试

- `apps/web/next.config.ts:8-15` 没有 CSP、`frame-ancestors`、HSTS、Referrer-Policy 等 headers 配置；Hub 的 CORS 又是全开放。
- Server 默认测试脚本只运行虚拟机清单测试（`apps/server/package.json`）；另一个布局测试由 workflow 单独调用。没有覆盖登录限速/会话过期、Socket 认证、ingest schema、设备删除、local store 损坏、聚合关机冲刷、周期保留或 Hub 更新状态机。

建议先为 P0/P1 修复建立黑盒安全回归测试，再加安全头。对 Web 建立 CSP 时需结合 Socket.IO、Next 静态资源和实际反向代理验证，不能只机械复制一组 header。

## 8. 文档与版本漂移

确认的漂移包括：

- `.env.example` 的 `DSC_VERSION=0.2.59`，当前根版本为 `0.2.285`（`.env.example:17`）。
- iOS 为 `0.2.68`，且版本验证脚本不检查。
- `docs/unified-desktop/current-architecture.md` 基线仍为 `0.2.62`，一处仍称 WinUI 为“current Windows UI”（`docs/unified-desktop/current-architecture.md:1-14`）。
- `docs/ui-rebuild/preserved-capabilities.md:48-52` 仍声称风扇备注是受控产品能力；当前 UI 已删除。
- 顶层跟踪了 262 个 release-notes 文件，已经明显淹没核心目录清单；其中本地还存在 3 个未跟踪旧版本 notes，本轮未修改。

这些漂移会误导安全边界评审和运维选择。建议生成式维护兼容矩阵和版本字段；文档明确区分“当前交付”“迁移输入”“历史归档”；Release notes 迁移到 GitHub Release 或按版本目录归档。

## 9. 修复优先级与建议执行顺序

### P0：立即阻断暴露并重建凭据边界

1. 为 Socket.IO 强制认证并停止广播完整 payload；上线前加入匿名连接回归测试。
2. 设计并实施 Agent 独立凭据 + 设备身份绑定；将管理员/查看者凭据与 Agent 凭据彻底分开。
3. 在上述两项完成后轮换全局访问密钥和 session secret，并通过会话版本强制注销全部旧会话。只轮换 `ACCESS_KEY` 不足以撤销当前 cookie。

### P1：修复当前产品的数据正确性与交付信任

1. 给 ingest 增加版本化运行时 schema、范围/容量/时间校验和幂等性。
2. 实现设备 tombstone 或事务型硬删除，阻止实时/历史自动复活。
3. 修复 local store 的 fail-open、写队列永久 rejected 和无界小时历史；生产依赖不可用时明确 fail closed。
4. 持久化/周期冲刷聚合桶，定期执行 retention，捕获后台任务异常。
5. Android Release 强制 HTTPS；默认 Compose 不再公开 Redis/MySQL。
6. 正式 Release/生产部署绑定 non-prerelease、固定签名和镜像 digest；固定测试 APK 签名身份。
7. 对 PawnIO 和全部高权限二进制建立独立来源与签名校验。
8. 若仍有旧 WinUI/GTK 安装，先发布一次安全迁移/退役版本，修复固定端口无 token 和 WebView Origin 问题。

### P2：收缩架构与历史负担

1. 产品决策并一次性删除或恢复：风扇备注、Hub 自更新、iOS。
2. 从 CI 和主线删除旧 WinUI/GTK/Web Dashboard 完整构建链；先把 Electron 图标移到中立品牌目录并保留必要迁移兼容。
3. 明确单实例约束或完成 Redis/MySQL/Socket.IO 多实例化。
4. 绑定 Agent spool 目的地，避免跨 Hub 自动迁移历史遥测。
5. 固定 Actions/依赖/Gradle/容器引用，补齐 Electron IPC、Web headers 与安全回归测试。

### P3：清理与治理

删除旧 Node Agent、孤立 presence 类型和失效文档；压缩/归档 release notes；建立“兼容代码必须有负责人、真实调用方、退出日期”的规则。

## 10. 本轮验证记录

| 检查项 | 结果 | 说明 |
|---|---|---|
| 当前生产 Web 入口追踪 | PASS | 路由均进入 `UnifiedConsole`；legacy Web 无生产 route import。 |
| 当前 Release 资产链追踪 | PASS | 证实 GUI 交付为 Electron，旧 WinUI/GTK 只在 CI 继续构建。 |
| 风扇备注删除历史与当前引用闭环 | PASS | Git 提交、当前 UI、共享端口、IPC、API、存储均已交叉核实。 |
| iOS 发布能力删除历史 | PASS | `c7204d7` 明确删除 iOS job/asset，当前 workflow 无 iOS。 |
| 设备删除后复活控制流 | PASS | delete -> closed -> realtime/history -> registerOrUpdate -> open 已逐段核实。 |
| 仓库自带静态边界检查 | PASS | `check-web-ui-boundary`、`check-desktop-ui-boundaries`、`check-adapter-contracts` 均通过；它们证明当前入口/适配器契约，不覆盖本文发现的运行时安全问题。 |
| 版本/安装器/Hub 端口静态检查 | PASS | `verify-version`、`verify-windows-installer-config`、`verify-hub-port` 均通过。 |
| 当前跟踪文件高特征密钥扫描 | PASS | 未发现常见 GitHub/AWS/Google token 或私钥头；这不是历史全量 secret scan。`.env` 被忽略且未读取。 |
| PawnIO sidecar 与当前文件哈希 | PASS（仅一致性） | 当前 SHA-256 与 sidecar 相同；CI 未执行该验证，sidecar 也不是独立信任根。 |
| 本地构建/单测/打包 | NOT RUN | 仓库要求所有构建、测试和打包只在 GitHub Actions 执行；本轮也只允许审计。 |
| 真实 Hub/浏览器/WebSocket 动态利用 | NOT RUN | 未对任何运行环境发起攻击或修改外部状态；结论来自可达调用链。 |
| Android/iOS/Windows 真机安全验收 | NOT RUN | 本轮未执行设备、安装器或 GUI 验收。 |
| 在线依赖 CVE/恶意包情报扫描 | NOT RUN | 本轮以当前仓库、Git 历史和项目资料为事实来源，未把易变的外部情报混入代码审计。 |

## 11. 已有的正向控制

为避免只列问题，以下控制在当前代码中确实存在，应在修复时保留：

- Electron 使用 `contextIsolation: true`、`nodeIntegration: false` 和本地 CSP；renderer 不直接获得 Node 能力。
- Electron/CLI 本地 backend 使用随机端口、随机 token 和权限收紧的 token 文件；Agent 配置原子写入并设为 0600（`agents/cmd/windows-agent-backend/atomic_file.go:9-41`）。
- Electron 用 `safeStorage`、Android 用 `EncryptedSharedPreferences` 保存访问密钥；Electron 返回 renderer 的 backend state 会移除明文 secret。
- Go Agent 对公网 HTTP 已实施拒绝，只允许 HTTPS 或私网/loopback HTTP（`agents/main.go:6280-6317`）；Electron HubClient 也有相同方向的限制（`apps/desktop/src/main/hub-client.ts:45-64,247-261`）。
- Agent 更新会校验 SHA-256，并对 ZIP 路径穿越进行防护（`agents/update.go:197-206,209-249`）。
- 生产 workflow 使用固定版本而非 `latest`，配置了 production environment 和显式 `known_hosts`；问题在于尚未验证正式 Release 身份和镜像 digest，而不是完全没有部署保护。

这些正向控制说明项目已经有安全意识，但目前不同客户端、旧新实现和发布通道之间的策略没有收敛成单一、可验证的契约。优先修复边界而不是继续在每个客户端各自追加例外，才能避免同类问题反复出现。
