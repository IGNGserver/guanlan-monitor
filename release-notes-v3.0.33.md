# 观澜 v3.0.33 测试版

- 稳定和测试渠道都不再强制 `SESSION_COOKIE_SECURE=true` 与 `AGENT_REQUIRE_HTTPS=true`。
- 两项配置默认仍为安全值 `true`，但用户可在明确受信的 HTTP 网络中显式设置为 `false`。
- Compose 预检、server 启动校验和部署说明保持该配置一致，允许稳定渠道通过 HTTP 登录并接收 Agent 上报。
