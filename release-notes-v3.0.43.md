# Guanlan / 观澜 v3.0.43（测试版）

## Carbon 通知交互修复

- 将总览页带有“查看详情”操作的 Carbon 通知改为 `ActionableNotification` 的 inline 变体，避免交互按钮嵌入非交互通知内容导致首屏客户端异常。
- 保留中枢连接异常、无设备和设备异常三种状态的原有跳转语义，并让操作按钮使用 Carbon 原生可访问交互。

本版本为测试版 release，不代表稳定生产发布。
