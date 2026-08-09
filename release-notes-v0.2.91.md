# Release v0.2.91

## 新增功能
- **中枢设备注册与状态流转**：新增 `devices` 设备数据表（支持 MySQL 及 Local JSON），实现 Agent 自动注册、用户标记关闭（软删除）及在线 Agent 动态重激活机制。
- **设备排序持久化**：全网设备支持顺序重排，中枢持久化存储排序索引 `sort_order`，保证多端统一展现逻辑。
- **多端接口与 UI 接入**：在 Web 网页端、Desktop 桌面客户端、Windows WinUI 3 客户端、Android 客户端及 iOS 客户端全面集成设备删除与排序操作。
