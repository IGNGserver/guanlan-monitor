# Device State Console v0.2.286（测试版）

- 收紧 Hub 会话、Socket.IO 实时事件和 Agent ingest 边界。
- 修复本地 JSON 存储故障恢复、历史留存、聚合冲刷和设备删除复活问题。
- release Android 禁止明文 Hub，Windows PawnIO 进入固定来源、哈希和签名校验链。
- 固定 CI action、依赖安装、基础镜像和 Gradle 分发输入；生产部署改用不可变 GHCR digest。
- Electron IPC sender 与 renderer 导航增加来源校验，Web 增加安全响应头。

本版本为 GitHub Actions 生成的测试版 Release，不代表正式稳定发布。
