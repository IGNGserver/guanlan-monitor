# Round-3 Contract Mapping & Renderer Default Specification

本文档记录观澜 (Guanlan Spectrum Adaptive) Clean-Room 渲染器作为默认生产 Renderer 的完整契约映射与回退/Mock 开关规范。

---

## 1. 渲染器默认状态与可逆回退机制 (Default Renderer & Rollback)

### 1.1 默认生产渲染器
- **主渲染器**: `GuanlanApp` (`apps/desktop/src/renderer-guanlan/GuanlanApp.tsx`)。
- **加载逻辑**: 应用启动时默认渲染 `GuanlanApp`，无需手动在 Legacy 界面上点击预览按钮。

### 1.2 显式回退机制 (Rollback Mode)
- **触发条件**:
  - URL 查询参数包含 `?ui=legacy` 或 `?dsc_legacy_ui=true` 或 `?dsc_legacy_ui=1`
  - 或 `localStorage` 中配置 `dsc_legacy_ui=true`
- **设置界面回退动作**: 在观澜设置视图 (`SettingsView.tsx`) 的「界面版本与回退」卡片中提供「↺ 回退至 Legacy 界面」按钮，点击后自动设置 `localStorage.setItem("dsc_legacy_ui", "true")` 并刷新页面。
- **恢复观澜界面**: 在 Legacy 控制台顶栏右侧提供「✨ 切换至观澜 UI」按钮，点击后清除 `localStorage` 中的 `dsc_legacy_ui` 标记并重载页面。

### 1.3 样式隔离与生命周期 Reset (Scoped Base Reset)
- 当观澜激活时，根 DOM 元素 `html` 增加 `.guanlan-active` 类，消除旧 `renderer/index.css` 中全局 `html, body, #root` 的 dark-first 样式覆盖。
- 观澜语义 CSS (`tokens.css`, `layout.css`, `components.css`) 在 `.guanlan-active` / `.guanlan-app-root` 作用域下完整接管背景、文本、字体、滚动条与选中态。
- 当 Legacy 界面激活时，根 DOM 元素 `html` 增加 `.legacy-active` 类，完全保持 Legacy 传统样式的准确呈现。

---

## 2. 真实 IPC 桥接与 Mock 数据源开关 (Data Adapter & IPC Bridge)

### 2.1 默认真实 Bridge
- 在 Electron 生产环境中，默认实例化 `BridgeGuanlanDataAdapter` 并通过 `window.dsc` (`dscBridge`) 与 Electron 主进程 IPC 通信。

### 2.2 Mock 试看模式开关
- **触发条件**:
  - URL 查询参数包含 `?mock=1` 或 `?mock=true`
  - 或 `localStorage` 中配置 `dsc_mock_preview=true`
  - 或在设置视图中手动关闭「接入真实 Electron IPC Safe dscBridge」开关。

---

## 3. 契约接口审计与无障碍规范 (Contract & Accessibility Audits)

### 3.1 `@dsc/shared` 完整类型引入
- `bridgeAdapter.ts` 显式引入 `DesktopSnapshotRequest` 类型，确保 IPC 接口签名与数据契约与 `@dsc/shared` 100% 对齐。

### 3.2 JSX 样式属性驼峰化
- 全量清理 JSX `style={{ ... }}` 对象中的 kebab-case 键名（如 `justify-content`），统一替换为 React 标准 `justifyContent` 驼峰名。

### 3.3 SpectrumToggle 原生开关无障碍
- 将所有 `SpectrumToggle` 内部的 `role="switch"` 隐藏 `div` 替换为原生的 `<input type="checkbox" role="switch">`。
- 保持外观视觉样式与 Focus-Ring 的同时，支持浏览器原生的 `Tab` 焦点轮转、`Space` / `Enter` 键盘翻转与 `aria-label` / `label` 关联。

### 3.4 语义化交互与 Overlay 模态弹窗
- 模态弹窗与 Overlay 均标注 `role="dialog"` 与 `aria-modal="true"`，并绑定全局与输入框的 `Esc` 退出按键监听。
- 所有可点击控件统一使用 `<button type="button">`、`<input>` 或 `<select>`。

---

## 4. 自动化 CI 验证集成 (CI Verification Jobs)

- 根目录与 `apps/desktop` 的 CI 验证工作流 (GitHub Actions `ci.yml`) 已引入：
  - `pnpm check:desktop-ui-boundaries`: 校验 Clean-Room 隔离边界与未授权引用
  - `pnpm test:ui-helpers`: 运行 `layout.ts` 布局与响应式密度断言
  - `pnpm --filter @dsc/desktop typecheck`: 严格 TypeScript 编译无错检查
