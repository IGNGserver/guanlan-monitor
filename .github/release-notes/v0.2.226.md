# Device State Console v0.2.226（测试版）

## Android 协议与安全基线

- 补齐 Android 对当前 Hub 遥测响应的版本、容量、L3 缓存、内存提交上限、温度源、虚拟化和总览指标模型。
- 保留 Socket.IO `device:update` 事件中的 `latest` 数据，避免协议字段静默丢失。
- Android 时间范围与当前桌面端对齐：1 分钟、5 分钟、1 小时、6 小时、24 小时、7 天。
- Hub 地址校验与桌面端一致：公网必须使用 HTTPS，HTTP 仅允许 localhost 或私有网络地址，禁止 URL 内嵌用户名/密码。
- Release workflow 新增 Android unit test 与 lint 门禁。

本版本为测试版，不作为正式稳定安装源。
