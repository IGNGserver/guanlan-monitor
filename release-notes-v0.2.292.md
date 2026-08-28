# Device State Console v0.2.292（测试版）

本版完成 `AUDIT.md` 整改后的最终复核修正，重点收紧实际运行和升级路径：

- 恢复对旧 Agent 缺失 `system` 计数器的有限兼容，但非法计数器仍会被拒绝。
- Socket.IO 连接在签名会话到期时由服务端强制断开。
- 设备删除后，历史或缓存数据不再自动复活；仅后续权威 Agent/宿主上报可使其重新显示。
- Compose 部署增加强密钥预检、`.env` 备份/原子迁移、Redis 认证升级和 Redis/MySQL 健康检查。
- 修正 Secure cookie 下的部署持久化烟雾测试，HSTS 不再未经验证地覆盖全部子域。
- 测试版 Android 使用受控的固定签名身份；Windows GUI setup 在 Actions 中真实静默安装并校验安装版本。

## 已接受风险

本版不改变统一 `ACCESS_KEY` / device key 信任模型。Agent、查看者和管理操作共用凭据、Agent 凭据不绑定设备的风险，已由产品负责人明确接受。

> 这是测试版 Release，不代表稳定正式发布，不会更新 `latest` 或自动部署生产环境。
