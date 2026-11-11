# Device State Console v0.2.55（测试版）

## 本次更新

- 保留 Linux GNOME 原生 GUI、WebKitGTK 中枢页和 Ubuntu/Debian `amd64` `.deb` 安装包。
- 修正 Release runner 安装本地 Linux `.deb` 时的路径处理。
- 改进测试版 Android 签名流程：未配置或无法读取测试密钥时自动生成临时签名，避免阻塞其他平台资产发布。
