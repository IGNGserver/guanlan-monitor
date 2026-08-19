# v0.2.188

### 工作流与发布规范优化
1. **调整 Release 发布流程，停止发布 iOS 资产**：
   - 从 GitHub Actions 测试版发布工作流（`release-test.yml`）中移除 `ios` 打包 job 与 `.ipa` 资产发布依赖，不再消耗 macOS 构建资源。
   - 保留仓库内的 iOS 源码实现（`ios/` 目录），便于后续开发维护。
   - 更新发布文档与资产规范（`RELEASE.md`、`AGENTS.md`），明确当前发布资产范围（Windows GUI/CLI、Linux GUI/CLI、Android）。
