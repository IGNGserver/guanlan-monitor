import React from "react";
import { useGuanlan, GuanlanNavTab } from "../../context/GuanlanContext";
import { useTheme } from "../../context/ThemeContext";
import { SpectrumBadge } from "../Common/SpectrumBadge";
import { SpectrumButton } from "../Common/SpectrumButton";

export const GuanlanHeader: React.FC = () => {
  const { activeTab, snapshot, setCommandPaletteOpen, refresh } = useGuanlan();
  const { themeMode, setThemeMode, densitySetting, setDensitySetting } = useTheme();

  const tabTitles: Record<GuanlanNavTab, string> = {
    overview: "总览 — 系统与设备网络健康度",
    devices: "设备 — 远端节点列表与指标只读视图",
    history: "历史 — 流量数据与遥测时间轴",
    "this-device": "此设备 — 本机 Agent 生命周期与配置",
    diagnostics: "诊断 — 采集器管道与系统日志",
    settings: "设置 — Guanlan Spectrum Adaptive 偏好"
  };

  const isCache = snapshot?.source === "cache";
  const isOnline = snapshot?.devices.some((d) => d.status === "online");

  return (
    <header className="gl-header">
      <div className="gl-header-brand">
        <div className="gl-brand-icon">澜</div>
        <span className="gl-brand-name">观澜</span>
        <div className="gl-header-title">
          <span>{tabTitles[activeTab]}</span>
        </div>
      </div>

      <div className="gl-header-actions">
        {/* Status Badge */}
        {isCache ? (
          <SpectrumBadge status="cached" label="离线缓存数据" />
        ) : isOnline ? (
          <SpectrumBadge status="online" label="已连接 Hub" />
        ) : (
          <SpectrumBadge status="offline" label="Agent 状态未就绪" />
        )}

        {/* Command Search Trigger */}
        <SpectrumButton
          variant="secondary"
          size="sm"
          onClick={() => setCommandPaletteOpen(true)}
          title="按 '/' 键快速搜索"
          aria-label="搜索指令或设备"
        >
          <span aria-hidden="true">🔍</span>
          <span className="gl-header-btn-text"> 搜索 [/]</span>
        </SpectrumButton>

        {/* Theme Quick Selector */}
        <select
          className="gl-select gl-header-select"
          style={{ height: 26, fontSize: 11 }}
          value={themeMode}
          onChange={(e) => setThemeMode(e.target.value as any)}
          aria-label="主题模式"
          title={`主题模式: ${themeMode === "system" ? "系统跟随" : themeMode === "light" ? "浅色" : "深色"}`}
        >
          <option value="system">🌓 系统跟随</option>
          <option value="light">☀️ 浅色主题</option>
          <option value="dark">🌙 深色主题</option>
        </select>

        {/* Density Quick Selector */}
        <select
          className="gl-select gl-header-select"
          style={{ height: 26, fontSize: 11 }}
          value={densitySetting}
          onChange={(e) => setDensitySetting(e.target.value as any)}
          aria-label="交互密度"
          title={`交互密度: ${densitySetting === "auto" ? "自动密度" : densitySetting === "compact" ? "紧凑" : densitySetting === "comfortable" ? "标准" : "触控"}`}
        >
          <option value="auto">📐 自动密度</option>
          <option value="compact">紧凑 (28px)</option>
          <option value="comfortable">标准 (36px)</option>
          <option value="touch">触控 (44px)</option>
        </select>

        {/* Refresh Button */}
        <SpectrumButton
          variant="secondary"
          size="sm"
          onClick={refresh}
          title="按 F5 或 Ctrl+R 刷新"
          aria-label="刷新数据"
        >
          🔄
        </SpectrumButton>
      </div>
    </header>
  );
};
