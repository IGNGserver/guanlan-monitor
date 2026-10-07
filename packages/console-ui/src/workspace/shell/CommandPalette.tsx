import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { M3Dialog, M3SearchBar } from "../m3";
import { useWorkspace } from "../WorkspaceContext";
import { Icon } from "../ui";
import { visibleSettingsNavigation } from "./PrimaryNavigation";

type CommandGroup = "页面" | "操作" | "设置" | "设备";

/** Group order doubles as result rank: destinations, then actions, then settings. */
const commandGroupOrder: CommandGroup[] = ["页面", "操作", "设置", "设备"];

interface Command {
  group: CommandGroup;
  label: string;
  detail: string;
  keywords?: string[];
  action: () => void;
}

export function CommandPalette() {
  const { commandOpen, setCommandOpen, searchQuery, setSearchQuery, allDevices, navigate, openSettings, refresh, capabilities } = useWorkspace();
  const [activeIndex, setActiveIndex] = useState(0);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const commandOpenRef = useRef(commandOpen);
  commandOpenRef.current = commandOpen;

  useLayoutEffect(() => {
    if (!commandOpen || wasOpenRef.current) return;
    const activeElement = document.activeElement;
    restoreFocusRef.current = document.querySelector<HTMLElement>(".workspace-search-trigger")
      ?? (activeElement instanceof HTMLElement ? activeElement : null);
    wasOpenRef.current = true;
  }, [commandOpen]);

  useEffect(() => {
    if (commandOpen) setActiveIndex(0);
  }, [commandOpen]);

  useEffect(() => {
    if (commandOpen || !wasOpenRef.current) return;
    wasOpenRef.current = false;
    const frame = window.requestAnimationFrame(() => restoreFocusRef.current?.focus?.());
    return () => window.cancelAnimationFrame(frame);
  }, [commandOpen]);

  // Results are grouped because a flat list made "设置 · 外观" and a device that
  // happens to be named "外观设置" neighbours with nothing to tell them apart.
  const commands = React.useMemo<Command[]>(() => [
    { group: "页面", label: "打开总览", detail: "全部设备的健康状态与中枢连接", keywords: ["首页", "状态", "dashboard", "中枢"], action: () => navigate({ kind: "overview" }) },
    { group: "页面", label: "打开设备目录", detail: "搜索、筛选和管理全部设备", keywords: ["设备", "列表", "目录"], action: () => navigate({ kind: "devices" }) },
    { group: "操作", label: "刷新设备状态", detail: "重新读取中枢和设备数据", keywords: ["刷新", "同步", "reload"], action: () => void refresh() },
    { group: "操作", label: "打开连接设置", detail: capabilities.canConfigureConnection ? "填写中枢地址与访问密钥" : "查看当前会话与数据链路", keywords: ["中枢", "地址", "密钥", "连接", "会话"], action: () => openSettings("connections") },
    ...(capabilities.canManageLocalAgent ? [{ group: "操作" as const, label: "控制本机 Agent", detail: "启动、停止或重新检测硬件", keywords: ["采集", "上报", "agent"], action: () => openSettings("connections") }] : []),
    ...visibleSettingsNavigation(capabilities)
      .map((item) => ({ group: "设置" as const, label: `设置 · ${item.label}`, detail: "打开对应设置页", action: () => openSettings(item.id) })),
    ...allDevices.map((device): Command => ({ group: "设备", label: device.hostname, detail: `${device.os} · ${device.deviceId}`, action: () => navigate({ kind: "device", deviceId: device.deviceId }) }))
  ], [allDevices, capabilities, navigate, openSettings, refresh]);

  const filtered = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const matched = query ? commands.filter((command) => `${command.label} ${command.detail} ${(command.keywords ?? []).join(" ")}`.toLowerCase().includes(query)) : commands;
    return matched.slice().sort((left, right) => commandGroupOrder.indexOf(left.group) - commandGroupOrder.indexOf(right.group));
  }, [commands, searchQuery]);

  const close = () => { setCommandOpen(false); setSearchQuery(""); };
  const activeOptionId = filtered.length > activeIndex ? `workspace-command-option-${activeIndex}` : undefined;
  const select = (index: number) => {
    const command = filtered[index];
    if (!command) return;
    command.action();
    close();
  };

  useEffect(() => {
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (!commandOpenRef.current) return;
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setCommandOpen(false);
      setSearchQuery("");
    };
    window.addEventListener("keydown", handleWindowKeyDown, true);
    return () => window.removeEventListener("keydown", handleWindowKeyDown, true);
  }, [setCommandOpen, setSearchQuery]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => Math.min(index + 1, Math.max(filtered.length - 1, 0))); }
    if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)); }
    if (event.key === "Enter") { event.preventDefault(); select(activeIndex); }
  };

  return <M3Dialog open={commandOpen} onClose={close} headline="查找设备、页面和操作" className="guanlan-command-modal">
    {commandOpen && <div className="workspace-command" onKeyDown={handleKeyDown}>
      <M3SearchBar
        id="workspace-command-search"
        label="查找设备、页面或操作"
        autoFocus
        role="combobox"
        value={searchQuery}
        onChange={(event) => { setSearchQuery(event.target.value); setActiveIndex(0); }}
        onClear={() => { setSearchQuery(""); setActiveIndex(0); }}
        placeholder="搜索设备、页面或操作"
        aria-controls="workspace-command-list"
        aria-expanded={filtered.length > 0}
        aria-autocomplete="list"
        aria-activedescendant={activeOptionId}
      />
      <div id="workspace-command-list" className="workspace-command__list" role="listbox" aria-label="搜索结果">
        {filtered.length ? filtered.map((command, index) => {
          const showsGroup = index === 0 || filtered[index - 1].group !== command.group;
          return <React.Fragment key={`${command.group}-${command.label}-${index}`}>
            {showsGroup && <div className="workspace-command__group" role="presentation">{command.group}</div>}
            <button id={`workspace-command-option-${index}`} className={`workspace-command__item ${index === activeIndex ? "is-active" : ""}`} type="button" role="option" aria-selected={index === activeIndex} tabIndex={-1} onPointerEnter={() => setActiveIndex(index)} onClick={() => select(index)}><span><strong>{command.label}</strong><small>{command.detail}</small></span><Icon name="arrow" size={18} /></button>
          </React.Fragment>;
        }) : <div className="workspace-command__empty" role="status">没有匹配结果</div>}
      </div>
      <div className="workspace-command__footer"><span><kbd>↑</kbd><kbd>↓</kbd>选择</span><span><kbd>Enter</kbd>打开</span><span><kbd>Esc</kbd>关闭</span></div>
    </div>}
  </M3Dialog>;
}
