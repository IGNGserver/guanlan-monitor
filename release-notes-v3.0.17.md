# 观澜 v3.0.17 测试版

这是观澜监控系统的中枢运行稳定性守护、公网/外网 HTTP 穿透兼容与移动端/桌面端鲁棒性增强测试版。

### 核心变更
1. **中枢进程未捕获异常守护与 Redis 错误监听**：
   - 在 `apps/server/src/index.ts` 注册全局 `uncaughtException` 和 `unhandledRejection` 监听器，防止非致命未捕获异常导致 Node 进程崩溃退出；
   - 为 Redis 客户端配置连接重试退避并监听 `error` 事件，避免网络抖动或 Redis 服务瞬时断连触发未捕获 EventEmitter 异常；
   - 为 MySQL 连接池启用 KeepAlive、配置连接池参数并增加错误事件监听。
2. **解除桌面端与 Agent 对外网 HTTP 的硬编码强制拦截**：
   - 移除桌面端 `HubClient` 对非私有/公网 IP 和域名的硬编码强制 HTTPS 校验，支持外网通过 HTTP 穿透（如 FRP/NPS/NAT 映射）正常连接中枢；
   - 移除各采集 Agent（Go agent、Windows backend、CLI `dsc`、legacy agent）对外网 HTTP 的阻断拦截，兼容穿透环境并打印警告提示；
   - 优化中枢 `SESSION_COOKIE_SECURE` 配置校验，允许测试渠道在外网 HTTP 穿透场景下正常工作；
   - 优化桌面端提示文案与 401 自动静默重新登录逻辑。
3. **Android 端 401 静默重连机制与连接鲁棒性**：
   - 引入 `executeWithAuthRetry` 统一守卫，在遭遇 401 Unauthorized（会话过期）时自动使用本地保存的访问密钥进行静默重新登录并无缝重放请求，消除误报断联与离线；
   - 优化 OkHttpClient 超时时间至 15 秒并开启连接失败自动重试，提升弱网与穿透环境连接稳定性。

本版本仅作为 GitHub prerelease 测试版发布，不更新 `latest`，不用于生产部署。
