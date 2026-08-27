# AUDIT 整改记录

日期：2026-08-27

## 复核原则

本记录基于当前工作区代码逐项复核 `AUDIT.md`。报告中的问题只有在能从当前代码、工作流或部署配置得到证据时才实施修改；需要产品决策、兼容性承诺、凭据/证书或核心信任模型变更的项目没有擅自重构。

## 结论

| 项目 | 当前结论 | 处理 |
| --- | --- | --- |
| F-01 | 真实：未登录 Socket.IO 曾可收到包含 `latest` 的完整遥测 | 已修复：Socket.IO 校验签名会话；实时事件只发送摘要 |
| F-02 | 真实且属于核心信任模型：agent、管理员和 viewer 共用访问密钥，凭据未绑定身份/设备 | 留给 `NEEDS_SOL_REVIEW.md`，未做不兼容的认证迁移 |
| F-03 | 真实：会话无有效期、登录防护不足、CORS 过宽、生产弱配置风险存在 | 已修复高置信部分：会话 TTL/凭据版本校验、生产配置拒绝弱密钥、显式 CORS、登录限流、安全比较；撤销/空闲超时等与 F-02 关联的模型问题留审 |
| F-04 | 真实：ingest 主要依赖 TypeScript 类型，缺少运行时边界和大小限制 | 已修复：Zod 运行时校验、字段/数组限制、时间校验、4 MiB body limit |
| F-05 | 真实：Android release 曾允许明文 HTTP，服务地址来源过宽；Hub 的 HTTPS 转发判断也不能信任任意客户端头 | 已修复：release 禁止 cleartext，运行时只在 debug 可放宽；Hub 仅在显式 `TRUST_PROXY` 时信任代理协议，并加入测试 |
| F-06 | 真实：Redis 无认证且 Redis/MySQL 暴露宿主机端口 | 已修复：Redis 密码、认证 URL、移除宿主端口、固定基础设施镜像摘要 |
| F-07 | 真实但分路径：发布中的 Electron 安装器缺少安装结果处理，PawnIO 来源校验不足；旧 Inno 路径仍需兼容性决策 | 已修复发布路径：固定官方来源与 SHA-256、静态校验、Windows Authenticode 校验、非零退出码中止；旧 Inno 路径留审 |
| F-08 | 真实：物理设备删除后，旧实时/缓存状态可能重新制造 open 设备；虚拟机重开语义不明确 | 已修复物理设备路径：MySQL/local 都写入 closed tombstone、删除时清理实时状态，并加入测试；虚拟机语义留审 |
| F-09 | 真实：本地 JSON 损坏会退化为空库，写队列可能永久拒绝，历史无明确上限 | 已修复：损坏 fail-closed、队列拒绝后可恢复、分钟/小时留存和容量上限、测试 |
| F-10 | 真实：聚合仅驻留内存，退出可能丢失；定时任务错误处理和历史清理不足 | 已修复：串行聚合队列、退出 flush、周期留存清理、错误捕获、样本上限 |
| F-11 | 真实但属于产品数据语义：agent 离线积压迁移到当前 Hub | 留给 `NEEDS_SOL_REVIEW.md`，未擅自改变数据归属 |
| F-12 | 报告指出的单实例/多实例边界属于架构决策，当前代码证据不足以安全选定方案 | 留给 `NEEDS_SOL_REVIEW.md` |
| F-13 | 真实：生产部署可把 prerelease 或可变 tag 带入 stable，发布入口约束不足 | 已修复高置信部分：stable 校验正式 Release、拒绝 prerelease/latest、要求 semver、生产解析并锁定 GHCR digest；正式晋级/签名供应链留审 |
| F-14 | 真实：Android 曾有临时签名回退；Windows 正式代码签名凭据/证书未闭环 | 已修复 Android 回退；Windows 证书与正式发布身份留审 |
| F-15 | 真实：Actions、依赖安装、基础镜像和 Gradle 分发存在可变输入 | 已修复：Actions SHA、冻结 pnpm、固定基础镜像/Compose 镜像摘要、Gradle SHA-256 |
| F-16 | 真实：更新 agent 工作流曾使用 `accept-new` | 已修复：远程 SSH/SCP 要求显式 known_hosts 且 `StrictHostKeyChecking=yes` |
| F-17 | 真实：Electron IPC 未验证 sender，导航/新窗口边界不足 | 已修复：IPC sender/window/origin 校验，阻断不可信导航和新窗口 |
| F-18 | 真实：Web 缺少明确安全响应头和对应检查 | 已修复高置信部分：Next 安全头、转发协议头覆盖和 CI 静态检查；浏览器黑盒/CSP 实际运行验证需 Actions/部署环境 |
| L-01 | 真实：fanNote 数据链路仍存在，但删除它会影响历史数据/导出兼容性 | 留给 `NEEDS_SOL_REVIEW.md` |
| L-02 | 真实：Hub 自更新路径和状态机需要明确删除/恢复策略 | 留给 `NEEDS_SOL_REVIEW.md` |
| L-03 | 真实：旧 WinUI/GTK/旧 Inno 安装路径存在，但是否仍受支持无法由代码安全判断 | 留给 `NEEDS_SOL_REVIEW.md` |
| L-04 | 真实：iOS 代码和 API 存在安全/维护问题，但产品已不支持的处置方式不明确 | 留给 `NEEDS_SOL_REVIEW.md` |
| L-05 | 真实：旧 Web 文件存在；是否移除涉及兼容入口和部署清单 | 留给 `NEEDS_SOL_REVIEW.md` |
| L-06 | 真实：旧 Node Agent/孤立类型存在；是否仍有安装用户无法从仓库判断 | 留给 `NEEDS_SOL_REVIEW.md` |

## 验证边界

本机只执行 Git 和不产出交付物的静态检查；没有在本机运行 pnpm、Gradle、Go、Docker、安装器或部署命令。新增单元测试、类型检查、工作流构建、镜像发布和测试版 Release 应由 GitHub Actions 执行。Windows GUI setup 的本机静默安装必须在实际 Windows 环境完成；若当前环境没有 Windows 主机，该项只能报告为 `NOT RUN`，不能用 Linux 上的文件检查代替。
