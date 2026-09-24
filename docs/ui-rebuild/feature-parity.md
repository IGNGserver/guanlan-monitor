# Guanlan Renderer Feature Parity Review

## 保留

- Electron main/preload、context isolation、IPC bridge、托盘行为和 Agent lifecycle 未改动。
- Hub snapshot、metrics、history、traffic calendar、cache、startup settings、Agent start/stop/check-connection/detect-probes、secret/config patch 均通过新 adapter 映射。
- 远端设备只读；本机配置、Agent 控制和本机风扇备注仍保留写入能力。
- mock-first 预览与真实 `dscBridge` adapter 可切换。

## 端口核对

- Hub 对外访问端口统一为 `3100`（`.env.example`、Compose 公网映射、部署 workflow、客户端默认地址均如此）。
- Compose 中 `server:4000` 是 Docker 内部 API 端口，未暴露到宿主机；web 容器通过 `http://server:4000` 访问它，公网 Hub 仍只有 `3100`。`verify:hub-port` 已通过。

## 当前状态

- compact header 的最后一个视觉问题已由 `gemini-3.1-pro-high` 修复，并纳入待发布的 `v0.2.79`。
- Windows 安装后注册表、固定安装路径和单实例结果需在 `v0.2.79` Release 资产生成后完成最终实机验证。
