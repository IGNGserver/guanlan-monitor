# v0.2.260

## 修复测试 Agent 更新流程

- 远程以 root 登录的 Linux 节点直接执行 Agent 更新，不再依赖目标机安装 `sudo`。
- 测试 Agent 更新默认使用已确认的 PVE 集群 IP，避免依赖 NAS runner 上不存在的 SSH 主机别名。
- 保持 v0.2.259 中的 Proxmox 存储池采集与 Android 存储池展示功能。

## 校验

- 构建、测试、打包、Release 和 Agent 更新验证由 GitHub Actions 流程执行。
