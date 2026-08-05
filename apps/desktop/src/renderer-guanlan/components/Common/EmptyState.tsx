import React from "react";
import { SpectrumButton } from "./SpectrumButton";

export type StateVariant = "empty" | "cached" | "stopped" | "error" | "loading";

interface EmptyStateProps {
  variant: StateVariant;
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  variant,
  title,
  description,
  actionLabel,
  onAction
}) => {
  const defaults: Record<StateVariant, { title: string; desc: string; icon: string }> = {
    empty: {
      title: "暂无数据",
      desc: "未检索到匹配的设备记录或遥测指标。",
      icon: "📁"
    },
    cached: {
      title: "已加载离线缓存",
      desc: "由于与 Hub 网络连接中断，当前正在呈现只读快照数据。",
      icon: "📦"
    },
    stopped: {
      title: "本机 Agent 已停止",
      desc: "数据采集已暂停。请在「此设备」页面重新启动 Agent 服务。",
      icon: "⏸"
    },
    error: {
      title: "数据通信错误",
      desc: "无法与数据源建立安全握手。请检查 Hub 地址与网络设置。",
      icon: "⚠️"
    },
    loading: {
      title: "正在同步数据...",
      desc: "正在与 Agent 及 Hub 同步设备状态与遥测快照。",
      icon: "⏳"
    }
  };

  const current = defaults[variant];

  return (
    <div className="gl-state-container" role="status">
      <div style={{ fontSize: 32, marginBottom: 4 }}>{current.icon}</div>
      <div className="gl-state-title">{title || current.title}</div>
      <div className="gl-state-description">{description || current.desc}</div>
      {actionLabel && onAction && (
        <SpectrumButton variant="secondary" size="sm" onClick={onAction} style={{ marginTop: 8 }}>
          {actionLabel}
        </SpectrumButton>
      )}
    </div>
  );
};
