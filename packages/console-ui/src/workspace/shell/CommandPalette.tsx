import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useWorkspace } from "../WorkspaceContext";
import { Icon } from "../ui";
import { settingsNavigation } from "./PrimaryNavigation";

export function CommandPalette() {
  const { commandOpen, setCommandOpen, searchQuery, setSearchQuery, allDevices, navigate, openSettings, capabilities } = useWorkspace();
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 0 });
  useLayoutEffect(() => {
    if (!commandOpen || typeof window === "undefined") return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const visualViewport = window.visualViewport;
    const syncViewport = () => setViewport({ top: visualViewport?.offsetTop ?? 0, height: visualViewport?.height ?? window.innerHeight });
    syncViewport();
    const focusFrame = window.requestAnimationFrame(() => inputRef.current?.focus());
    visualViewport?.addEventListener("resize", syncViewport);
    visualViewport?.addEventListener("scroll", syncViewport);
    return () => { window.cancelAnimationFrame(focusFrame); visualViewport?.removeEventListener("resize", syncViewport); visualViewport?.removeEventListener("scroll", syncViewport); };
  }, [commandOpen]);
  useEffect(() => { if (commandOpen) setActiveIndex(0); }, [commandOpen]);
  useEffect(() => { if (!commandOpen) { previousFocusRef.current?.focus(); previousFocusRef.current = null; } }, [commandOpen]);
  if (!commandOpen) return null;
  const settingsCommands = settingsNavigation(capabilities)
    .filter((item) => item.id !== "agent" || capabilities.canManageLocalAgent)
    .filter((item) => item.id !== "connections" || capabilities.canConfigureConnection)
    .map((item) => ({ label: `设置 · ${item.label}`, detail: "打开设置分类", action: () => openSettings(item.id) }));
  const commands: Array<{ label: string; detail: string; action: () => void }> = [
    { label: "打开总览", detail: "查看所有设备状态", action: () => navigate({ kind: "overview" }) },
    { label: "打开设备目录", detail: "搜索、筛选和管理全部设备", action: () => navigate({ kind: "devices" }) },
    capabilities.canConfigureConnection ? { label: "打开连接设置", detail: "添加或重新认证中枢", action: () => openSettings("connections") } : { label: "打开中枢工作台", detail: "查看网页端同步和会话状态", action: () => openSettings("workspace") },
    ...(capabilities.canManageLocalAgent ? [{ label: "打开本机 Agent", detail: "控制本机采集服务", action: () => openSettings("agent") }] : []),
    ...settingsCommands,
    ...allDevices.map((device) => ({ label: device.hostname, detail: `${device.os} · ${device.deviceId}${device.hostName ? ` · 宿主机 ${device.hostName}` : ""}`, action: () => navigate({ kind: "device", deviceId: device.deviceId }) }))
  ];
  const query = searchQuery.trim().toLowerCase();
  const filtered = query ? commands.filter((command) => `${command.label} ${command.detail}`.toLowerCase().includes(query)) : commands;
  const select = (index: number) => { const command = filtered[index]; if (!command) return; command.action(); setCommandOpen(false); setSearchQuery(""); };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Tab") {
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex='-1'])") ?? []);
      if (focusable.length) {
        const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
        const nextIndex = event.shiftKey ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1) : (currentIndex + 1) % focusable.length;
        event.preventDefault();
        focusable[nextIndex]?.focus();
      }
      return;
    }
    if (event.key === "Escape") { event.preventDefault(); setCommandOpen(false); return; }
    if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => Math.min(index + 1, filtered.length - 1)); }
    if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)); }
    if (event.key === "Enter") { event.preventDefault(); select(activeIndex); }
  };
  const overlayStyle = { "--workspace-viewport-top": `${viewport.top}px`, "--workspace-viewport-height": `${viewport.height || window.innerHeight}px` } as React.CSSProperties;
  return <div className="workspace-overlay" style={overlayStyle} role="presentation" onPointerDown={() => setCommandOpen(false)}>
    <section ref={dialogRef} className="workspace-command" role="dialog" aria-modal="true" aria-label="搜索设备和命令" onPointerDown={(event) => event.stopPropagation()} onKeyDown={handleKeyDown}>
      <div className="workspace-command__input"><Icon name="search" /><input ref={inputRef} autoFocus role="combobox" aria-label="搜索设备、页面或命令" aria-expanded="true" aria-controls="workspace-command-list" value={searchQuery} onChange={(event) => { setSearchQuery(event.target.value); setActiveIndex(0); }} placeholder="搜索设备、页面或命令" /></div>
      <div id="workspace-command-list" className="workspace-command__list" role="listbox" aria-label="搜索结果">
        {filtered.length ? filtered.map((command, index) => <button id={`workspace-command-option-${index}`} className={`workspace-command__item ${index === activeIndex ? "is-active" : ""}`} type="button" role="option" aria-selected={index === activeIndex} key={`${command.label}-${index}`} onPointerEnter={() => setActiveIndex(index)} onClick={() => select(index)}><span><strong>{command.label}</strong><small>{command.detail}</small></span><Icon name="arrow" size={15} /></button>) : <div className="workspace-command__empty" role="status">没有匹配结果</div>}
      </div>
      <div className="workspace-command__footer"><span><kbd>↑</kbd><kbd>↓</kbd>选择</span><span><kbd>Enter</kbd>打开</span><span><kbd>Esc</kbd>关闭</span></div>
    </section>
  </div>;
}
