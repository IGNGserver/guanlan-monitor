# Release Notes - v0.2.30

## 亮点与新增支持
- **新增 iOS / iPadOS 原生客户端 (SwiftUI)**：
  - 与 Android 端 1:1 视觉排版及交互逻辑全面对齐。
  - 支持服务器配置登录、设备列表状态 Pills、硬件监控控制台（CPU/内存/磁盘/网络/GPU/风扇）、硬件 Block 抽屉明细与流量日历统计。
  - 基于 SwiftUI Canvas 实现高精度迷你折线图与触摸探针交互。
- **CI/CD 自动化构建**：
  - GitHub Actions 配置 `ios` 打包 job，在 `macos-latest` runner 上自动生成未签名的通用 `.ipa` 资产（`DeviceStateConsole-iOS-GUI-v0.2.30-unsigned.ipa`），便于自签名安装。
