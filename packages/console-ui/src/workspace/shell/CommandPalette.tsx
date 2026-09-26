import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Modal, Search } from "@carbon/react";
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
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const launcherButtonRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const commandOpenRef = useRef(commandOpen);
  commandOpenRef.current = commandOpen;
  const focusLauncher = () => {
    const launcher = launcherButtonRef.current?.isConnected
      ? launcherButtonRef.current
      : restoreFocusRef.current?.isConnected
        ? restoreFocusRef.current
        : document.querySelector<HTMLElement>(".workspace-search-trigger");
    if (!launcher) return;
    const focusTarget = launcher.matches("button, a[href], input, select, textarea")
      ? launcher
      : launcher.querySelector<HTMLElement>("button, a[href], input, select, textarea") ?? launcher;
    focusTarget.focus();
  };
  useLayoutEffect(() => {
    if (!commandOpen || wasOpenRef.current) return;
    const activeElement = document.activeElement;
    restoreFocusRef.current = document.querySelector<HTMLElement>(".workspace-search-trigger")
      ?? (activeElement instanceof HTMLElement && !activeElement.closest(".cds--modal-container") ? activeElement : null);
    launcherButtonRef.current = restoreFocusRef.current;
    wasOpenRef.current = true;
  }, [commandOpen]);
  useEffect(() => {
    if (commandOpen || !wasOpenRef.current) return;
    wasOpenRef.current = false;
    restoreFocusRef.current = null;
    let firstFrame = 0;
    let secondFrame = 0;
    let transitionTimer = 0;
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        focusLauncher();
      });
    });
    transitionTimer = window.setTimeout(focusLauncher, 320);
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      window.clearTimeout(transitionTimer);
    };
  }, [commandOpen]);
  useEffect(() => {
    if (!commandOpen) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [commandOpen]);
  useEffect(() => { if (commandOpen) setActiveIndex(0); }, [commandOpen]);

  // Results are grouped because a flat list made "设置 · 外观" and a device that
  // happens to be named "外观设置" neighbours with nothing to tell them apart.
  const settingCommands: Command[] = visibleSettingsNavigation(capabilities)
    .map((item) => ({ group: "设置" as const, label: `设置 · ${item.label}`, detail: "打开对应设置页", action: () => openSettings(item.id) }));
  const commands: Command[] = [
    { group: "页面", label: "打开总览", detail: "全部设备的健康状态与中枢连接", keywords: ["首页", "状态", "dashboard", "中枢"], action: () => navigate({ kind: "overview" }) },
    { group: "页面", label: "打开设备目录", detail: "搜索、筛选和管理全部设备", keywords: ["设备", "列表", "目录"], action: () => navigate({ kind: "devices" }) },
    { group: "操作", label: "刷新设备状态", detail: "重新读取中枢和设备数据", keywords: ["刷新", "同步", "reload"], action: () => void refresh() },
    { group: "操作", label: "打开连接设置", detail: capabilities.canConfigureConnection ? "填写中枢地址与访问密钥" : "查看当前会话与数据链路", keywords: ["中枢", "地址", "密钥", "连接", "会话"], action: () => openSettings("connections") },
    ...(capabilities.canManageLocalAgent ? [{ group: "操作" as const, label: "控制本机 Agent", detail: "启动、停止或重新检测硬件", keywords: ["采集", "上报", "agent"], action: () => openSettings("agent") }] : []),
    ...settingCommands,
    ...allDevices.map((device): Command => ({ group: "设备", label: device.hostname, detail: `${device.os} · ${device.deviceId}`, action: () => navigate({ kind: "device", deviceId: device.deviceId }) }))
  ];
  const query = searchQuery.trim().toLowerCase();
  const matched = query ? commands.filter((command) => `${command.label} ${command.detail} ${(command.keywords ?? []).join(" ")}`.toLowerCase().includes(query)) : commands;
  const filtered = matched.slice().sort((left, right) => commandGroupOrder.indexOf(left.group) - commandGroupOrder.indexOf(right.group));
  const close = () => { setCommandOpen(false); setSearchQuery(""); };
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
  const handleKeyDownCapture = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };

  return <Modal
    open={commandOpen}
    launcherButtonRef={launcherButtonRef}
    passiveModal
    modalLabel="快捷导航"
    modalHeading="查找设备、页面和操作"
    className="guanlan-command-modal"
    onTransitionEnd={(event) => { if (!commandOpen && event.target === event.currentTarget) focusLauncher(); }}
    onRequestClose={close}
  >
    {commandOpen && <div className="workspace-command" onKeyDownCapture={handleKeyDownCapture} onKeyDown={handleKeyDown}>
      <Search ref={inputRef} id="workspace-command-search" labelText="查找设备、页面或操作" value={searchQuery} onChange={(event) => { setSearchQuery(event.target.value); setActiveIndex(0); }} onClear={() => { setSearchQuery(""); setActiveIndex(0); }} placeholder="搜索设备、页面或操作" size="lg" />
      <div id="workspace-command-list" className="workspace-command__list" role="listbox" aria-label="搜索结果">
        {filtered.length ? filtered.map((command, index) => {
          const showsGroup = index === 0 || filtered[index - 1].group !== command.group;
          return <React.Fragment key={`${command.group}-${command.label}-${index}`}>
            {showsGroup && <div className="workspace-command__group" role="presentation">{command.group}</div>}
            <button id={`workspace-command-option-${index}`} className={`workspace-command__item ${index === activeIndex ? "is-active" : ""}`} type="button" role="option" aria-selected={index === activeIndex} onPointerEnter={() => setActiveIndex(index)} onClick={() => select(index)}><span><strong>{command.label}</strong><small>{command.detail}</small></span><Icon name="arrow" size={15} /></button>
          </React.Fragment>;
        }) : <div className="workspace-command__empty" role="status">没有匹配结果</div>}
      </div>
      <div className="workspace-command__footer"><span><kbd>↑</kbd><kbd>↓</kbd>选择</span><span><kbd>Enter</kbd>打开</span><span><kbd>Esc</kbd>关闭</span></div>
    </div>}
  </Modal>;
}
