# 中枢健壮性与公网/外网 HTTP 穿透连接排障与优化计划

## 1. 背景与现状分析

当前系统（“观澜”监控系统）由中枢服务端（`apps/server` 基于 Fastify + Socket.IO + MySQL/Redis）、Web 控制台（`apps/web` 基于 Next.js 反向代理）、跨平台桌面端（`apps/desktop` Electron 主进程 HubClient + 渲染进程）、Android 客户端（基于 Retrofit/OkHttp）以及各类采集 Agent（Go、C、WinUI）组成。

通过全链路源码静态分析与安全策略审计，在中枢运行健壮性、断网恢复、以及**“外网 HTTP 环境（如公网 IP 映射、NAT/DDNS、FRP/NPS 内网穿透、HTTP 端口转发）”**下，系统存在多处导致**桌面端或移动端无法连接中枢、误报“中枢离线”、甚至中枢异常退出无法再次被连接**的问题与隐患。

---

## 2. 发现的问题与隐患清单

### 2.1 【P0 致命】桌面端硬编码拦截外网 HTTP，导致直接拒绝连接
- **位置**: `apps/desktop/src/main/hub-client.ts:45-64` (`setServerUrl`)
- **根因**:
  ```typescript
  const localHost = isPrivateNetworkHost(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && localHost)) {
    this.serverUrl = "";
    return false;
  }
  ```
  桌面端在校验中枢地址时，**强制要求非私有 IP / 非 localhost 的域名或外网 IP 必须使用 `https:`**。
  如果用户在外网使用 HTTP 穿透（例如 `http://123.45.67.89:3100` 或 `http://myfrp.domain.com:3100`），`isPrivateNetworkHost` 返回 `false`，导致 `this.serverUrl` 被置空并返回 `false`。
- **后果**: 桌面端在填写或连接外网 HTTP 地址时，直接抛出 `hub_server_url_invalid`，提示“公网地址必须使用 HTTPS，局域网 HTTP 仅支持私有地址”，**完全无法建立连接**。

### 2.2 【P0 致命】Go 采集 Agent 与 Linux GUI 硬编码强制外网 HTTPS
- **位置**:
  - `agents/main.go:6310-6319` (`validateServerTransport`)
  - `agents/cmd/windows-agent-backend/main.go:2400-2407`
  - `agents/cmd/dsc/main.go:967-974`
  - `linux-agent-gui/src/main.c:1001`
- **根因**:
  Go Agent 代码中写死：
  ```go
  if strings.EqualFold(parsed.Scheme, "http") && isPrivateNetworkHost(parsed.Hostname()) {
      return nil
  }
  return fmt.Errorf("remote_server_requires_https")
  ```
- **后果**: 当桌面端内嵌的采集 Agent 或独立机器的 Agent 尝试向外网 HTTP 中枢上报指标时，验证直接失败报错 `remote_server_requires_https`，导致设备无法上报数据，中枢判定设备离线；同时桌面端配置保存流程受阻。

### 2.3 【P0 严重】中枢进程缺少全局未捕获异常守护，Redis/MySQL 断连会导致中枢彻底崩溃退出
- **位置**: `apps/server/src/index.ts`
- **根因**:
  1. `index.ts` 中**完全没有注册 `process.on('uncaughtException')` 和 `process.on('unhandledRejection')`** 监听器。
  2. 初始化 Redis 时：
     ```typescript
     redisClient = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null })
     ```
     未在 `redisClient` 上注册 `redisClient.on('error', ...)`。在 Node.js `ioredis` 中，当 Redis 服务重启、网络波动或瞬时断连触发 EventEmitter 的 `'error'` 事件时，**若没有注册 error 监听器，Node.js 会抛出未捕获异常并直接使整个进程退出（Crash Exit）**。
  3. 定时器任务 `retentionTimer` 虽有 catch，但在某些未捕获的异步流或边缘路由抛出异步未捕获异常时，整个 Node 进程立即崩溃。在 Docker 容器或系统服务中，一旦中枢崩溃退出或重启循环，外部一切客户端将彻底无法连接。

### 2.4 【P1 重要】Android 客户端会话过期后自动刷新循环抛错，退回离线缓存
- **位置**:
  - `android/app/src/main/java/com/dsc/android/MainViewModel.kt:562-609` (`refreshOnce`)
  - `android/app/src/main/java/com/dsc/android/data.kt:97-104` (`InMemoryCookieJar`)
- **根因**:
  - Android 端的会话 Cookie (`dsc_session`) 具有 TTL（默认 7 天）。当 Cookie 过期或中枢重启导致 Session 失效后，`refreshOnce` 调用 `devices()` 返回 HTTP 401。
  - `refreshOnce` 的 catch 块仅将数据源降级为 `RemoteDataSource.Cache`，并显示“刷新失败”或“unauthorized”。
  - 与桌面端不同，Android 客户端没有像桌面端 `hub-client.ts` (`ensureSession`) 那样在捕获到 401 时**自动使用保存的 `accessKey` 调用 `/api/auth/login` 进行静默重连和会话刷新**，导致用户在后台静置或长期使用后提示断联或离线。

### 2.5 【P1 重要】中枢生产模式下的配置约束强制 `SESSION_COOKIE_SECURE=true` 与 `AGENT_REQUIRE_HTTPS=true`
- **位置**:
  - `apps/server/src/config.ts:79-84`
  - `apps/server/src/index.ts:105-107`
  - `apps/server/src/routes.ts:780-789` (`rejectInsecureAgentTransport`)
  - `apps/server/src/routes.ts:943` (`reply.setCookie`)
- **根因**:
  - 在生产模式下（`NODE_ENV=production` 且 `DSC_RELEASE_CHANNEL=stable`），如果用户未配置 TLS 证书而是使用公网 HTTP 穿透：
    1. 中枢在启动时会强制要求 `SESSION_COOKIE_SECURE=true` 和 `AGENT_REQUIRE_HTTPS=true`，否则直接拒绝启动抛出异常。
    2. 若 `SESSION_COOKIE_SECURE=true`，浏览器和某些 WebView 客户端在纯 HTTP 连接下会直接丢弃带有 `Secure` 属性的 Cookie，导致登录成功但随后的 API 均报 401 未授权。
    3. `rejectInsecureAgentTransport` 只要探测到协议非 HTTPS 就会直接拒绝 Agent 数据上报（返回 400 `https_required`）。
  - 当前测试渠道（`test`）虽然放宽了部分检查，但如果缺少明确的环境变量开关或配置指引，外网穿透场景极易被误杀。

### 2.6 【P1 细节】网络抖动与长耗时请求的超时与重试缺失
- **位置**:
  - `apps/desktop/src/main/hub-client.ts:215` (固定超时 12s)
  - `android/app/src/main/java/com/dsc/android/data.kt:214-230` (OkHttpClient 默认超时 10s，无重试拦截器)
- **根因**: 外网 HTTP 穿透（例如 FRP 穿透到家庭内网）容易出现瞬时网络抖动或丢包，当前各端只要单次 GET 请求超时便立即标记为连接失败并切入离线缓存。缺少指数退避重试或快速容错重连机制。

---

## 3. 开发实施计划

### 任务阶段一：中枢核心进程稳定性与容灾增强 (apps/server)
1. **进程级防崩溃守护**:
   - 在 `apps/server/src/index.ts` 中注册 `process.on('uncaughtException')` 与 `process.on('unhandledRejection')`，记录结构化错误日志，避免非致命异常导致整个 Node 进程崩毁。
2. **中间件与外部依赖错误处理**:
   - 为 Redis 客户端实例增加明确的 `redisClient.on('error', (err) => { app.log.error({ err }, "Redis connection error"); })` 错误监听，防止 EventEmitter 未处理错误引发崩溃。
   - 对 MySQL 连接池增加断线重连与查询异常兜底机制。
3. **HTTP 穿透兼容与安全配置调优**:
   - 优化 `config.ts`，允许通过环境变量明确控制 `SESSION_COOKIE_SECURE`（当在明文 HTTP 穿透环境部署时可配置为 `false`，避免纯 HTTP 登录后 Cookie 丢失）。
   - 确保 `AGENT_REQUIRE_HTTPS` 可在配置中受控关闭，且反向代理的 `trustProxy` 支持透传正确端口与协议。

### 任务阶段二：桌面端外网 HTTP 连接策略解禁与重连优化 (apps/desktop)
1. **解禁公网/外网 HTTP 拦截**:
   - 修改 `apps/desktop/src/main/hub-client.ts` 中的 `setServerUrl`：
     - 支持标准 HTTP 与 HTTPS 协议输入，不再强制判定外网域名/IP 必须为 HTTPS；
     - 当检测到使用公网非私有 IP/域名的明文 HTTP 时，给予安全提示（Warning），但不阻断连接。
2. **会话持久化与 401 自动重连刷新**:
   - 在 `hub-client.ts` 的 `request` 拦截逻辑中：当请求返回 401 且本地有已存储的 `accessKey` 时，自动尝试调用一次 `login` 刷新会话 Cookie 并重放请求，消除会话失效引起的误报离线。

### 任务阶段三：移动端 (Android) 自动重连与连接鲁棒性增强 (android)
1. **401 会话静默重新登录**:
   - 在 Android 端实现 OkHttp Authenticator 或在 `MainViewModel` 的 `refreshOnce` 捕获 401 异常时，自动读取本地存储的密钥发起静默登录并自动重试。
2. **穿透网络超时与重试优化**:
   - 调整 OkHttpClient 的 connectTimeout、readTimeout（如增加至 15s），并增加针对网络抖动的重试拦截机制。

### 任务阶段四：Agent 采集端与 CLI 的外网 HTTP 限制解禁 (agents)
1. **Go Agent 与 CLI 协议白名单调整**:
   - 修改 `agents/main.go`、`agents/cmd/windows-agent-backend/main.go`、`agents/cmd/dsc/main.go` 中的 `validateServerTransport` 函数；
   - 允许用户显式配置外网 HTTP 中枢地址（提供 `--insecure-http` 开关或直接允许 HTTP 但打印安全警告），保证数据能够正常向穿透中枢上报。

### 任务阶段五：全链路集成验证
1. **外网 HTTP 模拟测试**: 验证通过 `http://外网IP:端口` 或公网域名 HTTP 连接中枢时，桌面端、Android 端能正常登录、拉取设备列表、接收实时遥测。
2. **中枢异常模拟测试**: 模拟 Redis 临时停止/重启、数据库高延迟、异常 Payload，验证中枢不崩溃退出。
3. **长连接会话过期重连测试**: 验证 Cookie 过期后客户端无缝静默重连，不弹出“中枢离线”。

---

## 4. 交付与文档归档

本开发计划已归档至 `docs/HUB_STABILITY_AND_HTTP_TUNNEL_PLAN.md`。
下一个任务对话可直接依据该计划与提示词执行完整修复与测试。
