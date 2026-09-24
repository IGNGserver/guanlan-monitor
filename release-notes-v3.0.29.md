# 观澜 v3.0.29 测试版

移除独立 CLI 发行资产并支持无桌面/无头运行后，将产品形态统一定位为“桌面版”。

### 变更内容

1. **统一桌面版命名与发布资产规范**
   - 移除所有发布包文件名中的 `-GUI-` 标识（且不使用 `desktop`），资产命名调整为：
     - `DeviceStateConsole-Windows-Setup-v<版本>.exe`（Windows 安装包，支持 `/S` 静默安装及无界面参数化配置）
     - `DeviceStateConsole-Windows-Portable-v<版本>.zip`（Windows 便携版）
     - `DeviceStateConsole-Windows-Update-v<版本>.zip`（Windows 更新包）
     - `DeviceStateConsole-Linux-Install-v<版本>.deb`（Linux 安装包，内含系统级 systemd 服务）
   - Windows 启动验收证据资产文件更名为 `Windows-Release-Launch-Evidence-v<版本>.json`。
   - 同步更新打包配置（`apps/desktop/package.json`）、中枢自更新服务资产解析（`apps/server/src/updates.ts`）、Actions 发布工作流（`release-test.yml`、`update-agents-test.yml`、`performance-audit.yml`）及项目文档。

本版本仅作为 GitHub prerelease 测试版发布，不更新 `latest`，不用于生产部署。
