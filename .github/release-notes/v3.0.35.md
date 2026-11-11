# v3.0.35

- 修复纯 HTTP 访问中枢时登录接口成功但浏览器丢弃 `Secure` 会话 Cookie、页面误报访问密钥错误的问题。
- 稳定通道不再额外要求 32 位 `ACCESS_KEY`，与测试通道一样接受至少 6 位的非占位密钥。
- 测试和稳定部署工作流新增 `allow_http` 参数；仅显式启用时才将 `SESSION_COOKIE_SECURE` 与 `AGENT_REQUIRE_HTTPS` 写为 `false`。
