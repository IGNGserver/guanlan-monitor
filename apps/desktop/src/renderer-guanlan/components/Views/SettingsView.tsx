import React from "react";
import { useGuanlan } from "../../context/GuanlanContext";
import { useTheme } from "../../context/ThemeContext";
import { useLayout } from "../../context/LayoutContext";
import { SpectrumCard } from "../Common/SpectrumCard";
import { SpectrumBadge } from "../Common/SpectrumBadge";
import { SpectrumButton } from "../Common/SpectrumButton";
import { SpectrumToggle } from "../Common/SpectrumInput";

export const SettingsView: React.FC = () => {
  const { isMockAdapter, useRealBridge, setUseRealBridge } = useGuanlan();
  const {
    themeMode,
    setThemeMode,
    contrastMode,
    setContrastMode,
    motionMode,
    setMotionMode,
    densitySetting,
    setDensitySetting,
    effectiveTheme,
    effectiveDensity
  } = useTheme();

  const { layoutClass, width, height } = useLayout();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ fontSize: 16, fontWeight: 600, color: "var(--gl-text-primary)" }}>
        🛠️ 观澜桌面客户端设置 (Guanlan Spectrum Adaptive Settings)
      </div>

      <div className="gl-grid-adaptive-2">
        {/* Visual & Theme Control Card */}
        <SpectrumCard title="视觉语言与主题策略 (Guanlan Spectrum Adaptive)">
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label htmlFor="setting-theme-select" style={{ fontSize: 12, fontWeight: 500, color: "var(--gl-text-secondary)", display: "block", marginBottom: 4 }}>
                主题模式 (Theme Mode)
              </label>
              <select
                id="setting-theme-select"
                className="gl-select"
                style={{ width: "100%" }}
                value={themeMode}
                onChange={(e) => setThemeMode(e.target.value as any)}
              >
                <option value="system">🌓 自动跟随系统 (System Default)</option>
                <option value="light">☀️ 浅色模式 (Spectrum Light)</option>
                <option value="dark">🌙 深色模式 (Spectrum Dark)</option>
              </select>
              <div style={{ fontSize: 11, color: "var(--gl-text-muted)", marginTop: 4 }}>
                当前有效解析主题: <strong style={{ textTransform: "uppercase" }}>{effectiveTheme}</strong>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--gl-text-primary)" }}>低对比度模式 (Low Contrast)</div>
                <div style={{ fontSize: 11, color: "var(--gl-text-muted)" }}>降低色彩饱和度与边界反差，适合长时间阅读</div>
              </div>
              <SpectrumToggle
                label=""
                aria-label="低对比度模式"
                checked={contrastMode === "low"}
                onChange={(checked) => setContrastMode(checked ? "low" : "normal")}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--gl-text-primary)" }}>减弱动态效果 (Reduced Motion)</div>
                <div style={{ fontSize: 11, color: "var(--gl-text-muted)" }}>禁用微动画与渐进过渡，提高前台响应速度</div>
              </div>
              <SpectrumToggle
                label=""
                aria-label="减弱动态效果"
                checked={motionMode === "reduced"}
                onChange={(checked) => setMotionMode(checked ? "reduced" : "full")}
              />
            </div>
          </div>
        </SpectrumCard>

        {/* Interaction Scale & Layout Classes */}
        <SpectrumCard title="交互密度 scale & 布局 class 调整">
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label htmlFor="setting-density-select" style={{ fontSize: 12, fontWeight: 500, color: "var(--gl-text-secondary)", display: "block", marginBottom: 4 }}>
                交互密度 scale (Density Setting)
              </label>
              <select
                id="setting-density-select"
                className="gl-select"
                style={{ width: "100%" }}
                value={densitySetting}
                onChange={(e) => setDensitySetting(e.target.value as any)}
              >
                <option value="auto">📐 自动匹配 (Auto pointer/touch)</option>
                <option value="compact">紧凑 (Compact 28px 目标)</option>
                <option value="comfortable">标准 (Comfortable 36px 目标)</option>
                <option value="touch">触控 (Touch 44px 目标)</option>
              </select>
              <div style={{ fontSize: 11, color: "var(--gl-text-muted)", marginTop: 4 }}>
                当前有效密度 scale: <strong style={{ textTransform: "uppercase" }}>{effectiveDensity}</strong>
              </div>
            </div>

            <div style={{ borderTop: "1px solid var(--gl-border-subtle)", paddingTop: 10 }}>
              <div style={{ fontSize: 12, color: "var(--gl-text-secondary)" }}>Material 3 Adaptive 布局信息</div>
              <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
                <SpectrumBadge status="online" label={`窗口宽度: ${width}px`} />
                <SpectrumBadge status="online" label={`窗口高度: ${height}px`} />
                <SpectrumBadge status="cached" label={`布局 Class: gl-layout-${layoutClass}`} />
              </div>
            </div>
          </div>
        </SpectrumCard>
      </div>

      <div className="gl-grid-adaptive-2">
        {/* Data Adapter & Real Bridge Toggle */}
        <SpectrumCard title="数据层适配器 (Architecture Integration Seam)">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 12, color: "var(--gl-text-secondary)" }}>
              观澜 Renderer 采用纯粹数据适配器模式。默认在 Electron 环境中使用真实 IPC `dscBridge` 通道。也可手动切换至 Mock Preview 模式用于截图审核。
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--gl-text-primary)" }}>接入真实 Electron IPC Safe dscBridge</div>
                <div style={{ fontSize: 11, color: "var(--gl-text-muted)" }}>
                  关闭开启 Mock 试看预览模式，开启使用实际 Electron Preload IPC 桥接
                </div>
              </div>
              <SpectrumToggle
                label=""
                aria-label="接入真实 Electron IPC Safe dscBridge"
                checked={useRealBridge}
                onChange={setUseRealBridge}
              />
            </div>

            <div>
              当前激活适配器:{" "}
              {isMockAdapter ? (
                <SpectrumBadge status="cached" label="MockGuanlanDataAdapter (Mock Preview)" />
              ) : (
                <SpectrumBadge status="online" label="BridgeGuanlanDataAdapter (dscBridge)" />
              )}
            </div>
          </div>
        </SpectrumCard>

        {/* UI Version & Legacy Rollback */}
        <SpectrumCard title="界面版本与回退 (UI Rollback & Compatibility)">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--gl-text-primary)" }}>
                当前默认渲染器: <strong>观澜 (Guanlan Spectrum Adaptive)</strong>
              </div>
              <div style={{ fontSize: 11, color: "var(--gl-text-muted)" }}>
                若遇兼容需求，可一键回退至 Legacy 控制台 (也可在 URL 中加上 ?ui=legacy 临时回退)。
              </div>
            </div>
            <SpectrumButton
              variant="secondary"
              size="sm"
              onClick={() => {
                localStorage.setItem("dsc_legacy_ui", "true");
                window.location.reload();
              }}
            >
              ↺ 回退至 Legacy 界面
            </SpectrumButton>
          </div>
        </SpectrumCard>

        {/* Keyboard Access Cheatsheet */}
        <SpectrumCard title="无障碍与快捷键指南 (Keyboard Access)">
          <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--gl-border-subtle)", paddingBottom: 4 }}>
              <kbd style={{ fontFamily: "var(--gl-font-mono)", background: "var(--gl-surface-quiet)", color: "var(--gl-text-primary)", padding: "2px 6px", borderRadius: 4 }}>/</kbd>
              <span>聚焦并打开搜索/命令面板</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--gl-border-subtle)", paddingBottom: 4 }}>
              <kbd style={{ fontFamily: "var(--gl-font-mono)", background: "var(--gl-surface-quiet)", color: "var(--gl-text-primary)", padding: "2px 6px", borderRadius: 4 }}>Esc</kbd>
              <span>关闭命令面板或弹层</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--gl-border-subtle)", paddingBottom: 4 }}>
              <kbd style={{ fontFamily: "var(--gl-font-mono)", background: "var(--gl-surface-quiet)", color: "var(--gl-text-primary)", padding: "2px 6px", borderRadius: 4 }}>F5 / Ctrl+R</kbd>
              <span>刷新系统遥测快照</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <kbd style={{ fontFamily: "var(--gl-font-mono)", background: "var(--gl-surface-quiet)", color: "var(--gl-text-primary)", padding: "2px 6px", borderRadius: 4 }}>Tab / Shift+Tab</kbd>
              <span>在标准 focus-ring 下轮转交互元素</span>
            </div>
          </div>
        </SpectrumCard>
      </div>

      {/* App Info Card */}
      <SpectrumCard>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
          <div>
            <strong>观澜 设备状态控制台</strong> (Guanlan Spectrum Adaptive Clean-Room UI v0.2.77)
          </div>
          <div style={{ color: "var(--gl-text-muted)", fontFamily: "var(--gl-font-mono)" }}>
            Electron 37.2.6 | React 19.1.1 | Node 24.3.0
          </div>
        </div>
      </SpectrumCard>
    </div>
  );
};
