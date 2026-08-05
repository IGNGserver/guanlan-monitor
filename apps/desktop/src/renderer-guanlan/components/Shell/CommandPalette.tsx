import React, { useState, useEffect, useRef } from "react";
import { useGuanlan } from "../../context/GuanlanContext";
import { useTheme } from "../../context/ThemeContext";

interface CommandItem {
  id: string;
  category: "页面" | "动作" | "设备";
  title: string;
  subtitle?: string;
  onSelect: () => void;
}

export const CommandPalette: React.FC = () => {
  const {
    commandPaletteOpen,
    setCommandPaletteOpen,
    setActiveTab,
    snapshot,
    setSelectedDeviceId,
    refresh,
    controlAgent
  } = useGuanlan();
  const { setThemeMode } = useTheme();

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (commandPaletteOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [commandPaletteOpen]);

  if (!commandPaletteOpen) return null;

  const commands: CommandItem[] = [
    {
      id: "nav-overview",
      category: "页面",
      title: "跳转至 总览 页面",
      subtitle: "查看整体系统健康与关键指标",
      onSelect: () => {
        setActiveTab("overview");
        setCommandPaletteOpen(false);
      }
    },
    {
      id: "nav-devices",
      category: "页面",
      title: "跳转至 设备 列表",
      subtitle: "查看全网设备只读明细",
      onSelect: () => {
        setActiveTab("devices");
        setCommandPaletteOpen(false);
      }
    },
    {
      id: "nav-history",
      category: "页面",
      title: "跳转至 历史 流量",
      subtitle: "分析日历流量与遥测数据",
      onSelect: () => {
        setActiveTab("history");
        setCommandPaletteOpen(false);
      }
    },
    {
      id: "nav-this-device",
      category: "页面",
      title: "跳转至 此设备 控制台",
      subtitle: "配置本机 Agent 与服务控制",
      onSelect: () => {
        setActiveTab("this-device");
        setCommandPaletteOpen(false);
      }
    },
    {
      id: "nav-diagnostics",
      category: "页面",
      title: "跳转至 诊断 诊断日志",
      subtitle: "查看 Spool 队列与探针分析",
      onSelect: () => {
        setActiveTab("diagnostics");
        setCommandPaletteOpen(false);
      }
    },
    {
      id: "nav-settings",
      category: "页面",
      title: "跳转至 设置 偏好控制",
      subtitle: "配置 Guanlan Spectrum Adaptive 主题与密度",
      onSelect: () => {
        setActiveTab("settings");
        setCommandPaletteOpen(false);
      }
    },
    {
      id: "action-refresh",
      category: "动作",
      title: "刷新系统遥测快照",
      subtitle: "从 Bridge / Hub 获取最新数据",
      onSelect: () => {
        refresh();
        setCommandPaletteOpen(false);
      }
    },
    {
      id: "action-agent-restart",
      category: "动作",
      title: "重启本机 Agent 服务",
      subtitle: "先停止再启动本机 Agent 服务",
      onSelect: () => {
        controlAgent("restart");
        setCommandPaletteOpen(false);
      }
    },
    {
      id: "action-theme-dark",
      category: "动作",
      title: "切换主题: 深色模式 (Dark)",
      onSelect: () => {
        setThemeMode("dark");
        setCommandPaletteOpen(false);
      }
    },
    {
      id: "action-theme-light",
      category: "动作",
      title: "切换主题: 浅色模式 (Light)",
      onSelect: () => {
        setThemeMode("light");
        setCommandPaletteOpen(false);
      }
    }
  ];

  // Dynamically add devices from snapshot
  if (snapshot?.devices) {
    snapshot.devices.forEach((dev) => {
      commands.push({
        id: `dev-${dev.deviceId}`,
        category: "设备",
        title: `查看设备: ${dev.hostname}`,
        subtitle: `ID: ${dev.deviceId} | OS: ${dev.os} | 状态: ${dev.status}`,
        onSelect: () => {
          setSelectedDeviceId(dev.deviceId);
          setActiveTab("devices");
          setCommandPaletteOpen(false);
        }
      });
    });
  }

  const filtered = commands.filter((cmd) => {
    const q = query.toLowerCase();
    return (
      cmd.title.toLowerCase().includes(q) ||
      cmd.category.toLowerCase().includes(q) ||
      (cmd.subtitle && cmd.subtitle.toLowerCase().includes(q))
    );
  });

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % (filtered.length || 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filtered.length) % (filtered.length || 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        filtered[selectedIndex].onSelect();
      }
    } else if (e.key === "Escape") {
      setCommandPaletteOpen(false);
    }
  };

  return (
    <div
      className="gl-overlay-backdrop"
      onClick={() => setCommandPaletteOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="命令面板"
    >
      <div className="gl-command-modal" onClick={(e) => e.stopPropagation()}>
        <div className="gl-command-input-wrapper">
          <span aria-hidden="true">🔍</span>
          <input
            ref={inputRef}
            className="gl-command-input"
            aria-label="搜索指令、动作或设备"
            placeholder="搜索指令、动作或设备... (按 Esc 退出)"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
        </div>

        <div className="gl-command-list">
          {filtered.length === 0 ? (
            <div style={{ padding: "16px", textAlign: "center", color: "var(--gl-text-muted)", fontSize: 13 }}>
              未搜索到相关指令
            </div>
          ) : (
            filtered.map((cmd, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <button
                  type="button"
                  key={cmd.id}
                  className={`gl-command-item ${isSelected ? "focused" : ""}`}
                  onClick={() => cmd.onSelect()}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{cmd.title}</div>
                    {cmd.subtitle && (
                      <div style={{ fontSize: 11, color: "var(--gl-text-muted)" }}>{cmd.subtitle}</div>
                    )}
                  </div>
                  <span className="gl-badge gl-badge-offline" style={{ fontSize: 10 }}>
                    {cmd.category}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
