# 观澜 v3.0.32 测试版

- 允许测试渠道通过 `SESSION_COOKIE_SECURE=false` 在可信 HTTP 网络下保存网页登录会话。
- Compose 不再覆盖用户明确配置的 `SESSION_COOKIE_SECURE`；稳定渠道仍强制使用安全 Cookie。
- 保留 HTTPS 生产部署的安全默认值，并同步更新 Compose 预检和部署说明。
