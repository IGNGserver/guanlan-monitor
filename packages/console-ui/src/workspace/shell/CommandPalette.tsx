import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Modal, Search } from "@carbon/react";
import { useWorkspace } from "../WorkspaceContext";
import { Icon } from "../ui";
import { settingsNavigation } from "./PrimaryNavigation";

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

  const settingsCommands = settingsNavigation(capabilities)
    .filter((item) => item.id !== "agent" || capabilities.canManageLocalAgent)
    .filter((item) => item.id !== "connections" || capabilities.canConfigureConnection)
    .map((item) => ({ label: `设置 · ${item.label}`, detail: "打开设置分类", action: () => openSettings(item.id) }));
  const commands: Array<{ label: string; detail: string; keywords?: string[]; action: () => void }> = [
    { label: "打开总览", detail: "查看所有设备状态", keywords: ["首页", "状态", "dashboard"], action: () => navigate({ kind: "overview" }) },
    { label: "打开设备目录", detail: "搜索、筛选和管理全部设备", keywords: ["设备", "列表", "目录"], action: () => navigate({ kind: "devices" }) },
    { label: "刷新设备状态", detail: "重新读取中枢和设备数据", keywords: ["刷新", "同步", "reload"], action: () => void refresh() },
    capabilities.canConfigureConnection ? { label: "打开连接设置", detail: "添加或重新认证中枢", keywords: ["中枢", "地址", "密钥", "连接"], action: () => openSettings("connections") } : { label: "打开中枢状态", detail: "查看网页端同步和会话状态", keywords: ["中枢", "会话", "连接"], action: () => openSettings("workspace") },
    ...(capabilities.canManageLocalAgent ? [{ label: "打开本机 Agent", detail: "控制本机采集服务", keywords: ["采集", "上报", "agent"], action: () => openSettings("agent") }] : []),
    ...settingsCommands,
    ...allDevices.map((device) => ({ label: device.hostname, detail: `${device.os} · ${device.deviceId}`, action: () => navigate({ kind: "device", deviceId: device.deviceId }) }))
  ];
  const query = searchQuery.trim().toLowerCase();
  const filtered = query ? commands.filter((command) => `${command.label} ${command.detail} ${(command.keywords ?? []).join(" ")}`.toLowerCase().includes(query)) : commands;
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
      <Search ref={inputRef} id="workspace-command-search" labelText="查找设备、页面或操作" value={searchQuery} onChange={(event) => { setSearchQuery(event.target.value); setActiveIndex(0); }} onClear={() => { setSearchQuery(""); setActiveIndex(0); }} placeholder="设备名、ID、页面、设置或操作" size="lg" />
      <div id="workspace-command-list" className="workspace-command__list" role="listbox" aria-label="搜索结果">
        {filtered.length ? filtered.map((command, index) => <button id={`workspace-command-option-${index}`} className={`workspace-command__item ${index === activeIndex ? "is-active" : ""}`} type="button" role="option" aria-selected={index === activeIndex} key={`${command.label}-${index}`} onPointerEnter={() => setActiveIndex(index)} onClick={() => select(index)}><span><strong>{command.label}</strong><small>{command.detail}</small></span><Icon name="arrow" size={15} /></button>) : <div className="workspace-command__empty" role="status">没有匹配结果</div>}
      </div>
      <div className="workspace-command__footer"><span><kbd>↑</kbd><kbd>↓</kbd>选择</span><span><kbd>Enter</kbd>打开</span><span><kbd>Esc</kbd>关闭</span></div>
    </div>}
  </Modal>;
}
