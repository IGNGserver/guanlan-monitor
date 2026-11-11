# 观澜 v3.0.138

## 网页端 · 桌面端（共享控制台）

- 前端实现从 Carbon 彻底迁移到 **Material 3 Expressive**：移除 `@carbon/react` 与 `@carbon/charts-react` 依赖（依赖图减少 123 个包），图表改为无第三方运行时的自绘 SVG。
- 颜色、圆角、海拔、动效与排版全部由新的 M3E 令牌驱动；浅色/深色由单一解析器决定，不再出现“半套主题”。
- 导航（抽屉/轨道/底栏）、顶栏、命令面板、设备目录、设备详情、设置与登录页全部重写为 M3E 组件。
- Windows 原生标题栏按钮保持系统尺寸与字形不变。

## 兼容性

- 数据、适配器、路由、权限与 Agent 协议均未改变；旧书签与设置深链继续可用。
- 新增门禁：禁止 Carbon 依赖、`cds--` 类名与 `--cds-*` 令牌回流到前端。

## 说明

- 现行前端设计契约见 `docs/M3E_FRONTEND_REDESIGN.md`。

## 安装包

- Windows setup、Windows portable、Windows update、Linux install 与 Android APK 均随本 Release 发布，并附带 `.sha256` 校验文件。
