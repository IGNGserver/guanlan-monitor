# 设备身份（deviceId）约束

`deviceId` 是采集端在中枢里的唯一身份，不是展示名。它同时出现在：

- MySQL `devices.device_id`（主键）与两张历史表的 `device_id`；
- Redis 的实时状态、摘要和 1m/5m/15m 序列键；
- 服务端内存里的 `Map`/`Set` 键；
- Web/桌面/Android 的 API 路径与列表 key。

因此 **`deviceId` 区分大小写**：`nas2` 与 `NAS2` 是两个不同的设备身份。展示名走
`hostname`，改展示名不要动 `deviceId`。

## 历史库的排序规则

2026-11-04 起建表语句使用 `COLLATE=utf8mb4_bin`，但更早创建的库表继承了数据库默认的
大小写不敏感排序规则。`CREATE TABLE IF NOT EXISTS` 不会修改已有表。结果是在老库上把
agent 的 `deviceId` 从 `nas2` 改成 `NAS2` 时：

1. `SELECT ... WHERE device_id = 'NAS2'` 会命中 `nas2` 那一行；
2. 注册接口返回旧的 `device_id`（小写），实时状态却按 `NAS2` 存储；
3. `buildDeviceSummaries` 认为 `NAS2` 是“未注册设备”，每次读取列表都补注册一次，
   把同一条注册表记录再 push 一遍，列表出现两条 `nas2`；
4. WebSocket 的 `NAS2` 事件又会在前端新增一条在线记录，最终一台设备显示三行。

启动时 `ensureCaseSensitiveDeviceId()` 会检查 `INFORMATION_SCHEMA.COLUMNS`，把不是
`utf8mb4_bin` 的 `device_id` 列迁移一次；之后注册、列表和查询都按大小写敏感处理。
大表上的 `ALTER` 会重建索引，首次升级启动可能比平时慢。

## 改 deviceId 的正确顺序

1. 先停掉该设备上的 agent（或改好配置并停止上报）；
2. 在中枢把旧 id 迁移到新 id：
   ```http
   PUT /api/devices/<old-id>/id
   { "deviceId": "<new-id>" }
   ```
   Web 端也可以在离线设备的详情页用“重命名 ID”。服务端只允许**离线**设备重命名：
   - 设备仍在线 → `409 device_online`；
   - 新 id 已有设备记录或历史数据 → `409 device_id_conflict`；
   - 旧 id 不存在 → `404 device_not_found`。
   注册表与两张历史表在同一个 MySQL 事务里迁移；Redis 里的 1m/5m/15m 实时序列会清空，
   新 id 的实时窗口从下一次上报重新开始，持久历史不受影响。
3. 修改采集端配置并重启 agent，确认新 id 在线；
4. 确认旧记录不存在（它已经在第 2 步被迁移，不是“删除”）。

只改 agent、不迁中枢，会留下一条旧的离线记录（这是正常的“旧身份”记录，不再重复）；
只改中枢、不改 agent，agent 下次上报会把旧 id 重新注册回来。
