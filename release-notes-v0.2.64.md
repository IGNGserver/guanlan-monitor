# Device State Console v0.2.64（测试版）

## 统一桌面客户端

- 新增由 Electron + React + TypeScript + Vite 组成的 Windows/Linux 统一桌面客户端。
- 新渲染器由 Gemini Flash 通过 Antigravity `agy` 直接实现，覆盖设备舰队、遥测图表、设备详情、流量日历、本机配置、探针检测、诊断与 Secret/Hub 登录操作。
- Electron 主进程负责 Agent 生命周期、Hub 会话、safeStorage 凭据、缓存、托盘、启动项和安全 IPC；渲染器不接触明文 Secret 或 Node.js 能力。

## Agent 与数据可靠性

- Agent 上传失败样本进入有大小/时间上限的 JSONL 持久队列，恢复后按时间顺序重放并去重。
- Agent/Backend 支持优雅停止、父进程监管、随机 loopback 端口和每次运行的本地 IPC token。
- Hub 历史遥测新增 5 分钟、1 小时、6 小时、24 小时、7 天、30 天和 90 天窗口。

## 测试说明

- 本版本为 GitHub Actions 生成的测试版；Windows setup/portable/update、Linux GUI、CLI、Android 和 iOS 资产均由 workflow 构建或校验。
- 请优先使用本 Release 的 Windows GUI setup 资产验证安装；本版本不代表稳定发布，也不触发生产部署。
