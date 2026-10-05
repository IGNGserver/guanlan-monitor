import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { resolveWebPresentation, supportsTouchSplit, type WebPresentation } from "../../helpers/presentation";
import { useWorkspace } from "../WorkspaceContext";
import { WorkspaceFrame } from "../shell/WorkspaceFrame";
import { RouteView } from "../WorkspacePages";
import { SettingsPage } from "../pages/SettingsPage";
import { DeviceDetailsPage } from "../pages/DeviceDetailsPage";
import { LoadingSurface, ErrorSurface, EmptyState } from "../pages/shared";
import { visibleSettingsNavigation } from "../shell/PrimaryNavigation";
import { SessionRecoveryBanner, ShellNotice } from "../shell/AppTopBar";
import { CommandPalette } from "../shell/CommandPalette";
import { PullToRefresh } from "../shell/PullToRefresh";
import { Button, Icon } from "../ui";
import { M3IconButton } from "../m3";
import { formatDate } from "../formatters";
import { TouchStateProvider, useTouchDetail, useTouchState } from "./TouchState";
import { TouchOverview } from "./TouchOverview";
import { TouchDevices } from "./TouchDevices";
import { parseWorkspaceHash, serializeWorkspaceRoute, type SettingsSection, type WorkspaceRoute } from "../routes";
import { RenderBoundary } from "../RenderBoundary";

function usePresentation() {
  const { webLayout, capabilities } = useWorkspace();
  const [view, setView] = useState<{ presentation: WebPresentation; split: boolean }>({ presentation: "desktop", split: false });
  useLayoutEffect(() => {
    const coarse = window.matchMedia("(pointer: coarse)");
    const update = () => {
      const presentation = resolveWebPresentation({
        width: window.innerWidth, height: window.innerHeight,
        screenShortSide: Math.min(screen.width || window.innerWidth, screen.height || window.innerHeight),
        hasTouch: navigator.maxTouchPoints > 0, coarsePointer: coarse.matches,
        userAgent: navigator.userAgent, preference: webLayout, native: capabilities.canControlNativeWindow
      });
      const split = supportsTouchSplit(presentation, window.innerWidth);
      setView((current) => current.presentation === presentation && current.split === split ? current : { presentation, split });
    };
    update();
    window.addEventListener("resize", update);
    coarse.addEventListener("change", update);
    return () => { window.removeEventListener("resize", update); coarse.removeEventListener("change", update); };
  }, [webLayout, capabilities.canControlNativeWindow]);
  return view;
}

export function AdaptiveWorkspace() {
  return <TouchStateProvider><AdaptiveFrame /></TouchStateProvider>;
}
function AdaptiveFrame() {
  const view = usePresentation();
  if (view.presentation === "desktop") return <WorkspaceFrame><RouteView /></WorkspaceFrame>;
  return <TouchWorkspace presentation={view.presentation} split={view.split} />;
}
function TouchDetail({ deviceId }: { deviceId: string }) {
  const [view, update] = useTouchDetail(deviceId);
  return <DeviceDetailsPage presentation="touch" touchPanel={view.panel} onTouchPanelChange={(panel) => update({ panel })} touchTab={view.tab} onTouchTabChange={(tab) => update({ tab })} />;
}
const categoryDetails: Partial<Record<SettingsSection, string>> = {
  general: "刷新频率与状态同步", appearance: "主题、控件与网页布局", connections: "当前中枢与会话", data: "数据来源与更新", shortcuts: "键盘操作", about: "版本与帮助"
};
function TouchSettings({ split }: { split: boolean }) {
  const { route, capabilities, navigate } = useWorkspace();
  const { settingsCategory, setSettingsCategory } = useTouchState();
  const items = visibleSettingsNavigation(capabilities);
  const category = route.kind === "settings" && route.section !== "general" ? route.section : settingsCategory;
  const open = (section: SettingsSection) => {
    const sameRoute = route.kind === "settings" && route.section === section;
    navigate({ kind: "settings", section });
    if (sameRoute) window.history.pushState({ ...window.history.state, dscWorkspace: true, dscSettingsCategory: section, fromRoute: route }, "");
    else window.history.replaceState({ ...window.history.state, dscSettingsCategory: section }, "");
    setSettingsCategory(section);
  };
  return <div className={`touch-settings${split ? " is-split" : ""}`}>
    <div className="touch-settings__directory" hidden={!!category && !split}>
      <header className="touch-page-title"><h1>设置</h1><p>让观澜按你的习惯工作</p></header>
      <div className="touch-category-list">{items.map((item) => <button type="button" key={item.id} onClick={() => open(item.id)} aria-current={category === item.id ? "page" : undefined}>
        <span className="touch-category-icon"><Icon name={item.icon} /></span><span><strong>{item.label}</strong><small>{categoryDetails[item.id]}</small></span><Icon name="chevronRight" size={18} />
      </button>)}</div>
    </div>
    {category && <div className="touch-settings__content"><SettingsPage presentation="touch" /></div>}
  </div>;
}
function TouchWorkspace({ presentation, split }: { presentation: WebPresentation; split: boolean }) {
  const { route, navigate, snapshot, selectedDevice, refresh, refreshing, mutationPending, loading, error, isTouch } = useWorkspace();
  const { settingsCategory, setSettingsCategory, scroll } = useTouchState();
  const inDevices = route.kind === "devices" || route.kind === "device";
  const showDirectory = route.kind === "devices" || (split && inDevices);
  const showMain = !showDirectory || (split && inDevices);
  const main = useRef<HTMLElement>(null);
  const directory = useRef<HTMLElement>(null);
  const activeCategory = route.kind === "settings" && route.section !== "general" ? route.section : settingsCategory;
  const routeKey = route.kind === "device" ? `device:${route.deviceId}` : route.kind === "settings" ? `settings:${activeCategory ?? "list"}` : route.kind;
  const previousKey = useRef(routeKey);
  const backward = useRef(false);
  useLayoutEffect(() => {
    const scroller = main.current;
    if (!scroller) return;
    const oldKey = previousKey.current;
    if (oldKey !== routeKey) scroll.current.set(oldKey, scroller.scrollTop);
    previousKey.current = routeKey;
    scroller.scrollTop = scroll.current.get(routeKey) ?? 0;
    let animation: Animation | undefined;
    if (oldKey !== routeKey && !scroller.hidden) {
      scroller.focus({ preventScroll: true });
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        const motion = getComputedStyle(scroller).getPropertyValue("--md-sys-motion-spatial-fast").trim();
        const duration = Number.parseFloat(motion) || 350;
        animation = scroller.firstElementChild?.animate([{ opacity: 0, transform: `translateX(${backward.current ? -16 : 16}px)` }, { opacity: 1, transform: "translateX(0)" }], { duration, easing: motion.slice(motion.indexOf(" ") + 1) || "ease-out" });
      }
    }
    if (oldKey.startsWith("device:") && route.kind === "devices") {
      directory.current?.querySelector<HTMLElement>(`[data-device-id="${CSS.escape(oldKey.slice(7))}"]`)?.focus({ preventScroll: true });
    }
    backward.current = false;
    return () => { animation?.cancel(); scroll.current.set(routeKey, scroller.scrollTop); };
  }, [routeKey, scroll]);
  useLayoutEffect(() => {
    if (directory.current) directory.current.scrollTop = scroll.current.get("directory") ?? 0;
  }, [showDirectory, scroll]);
  useEffect(() => {
    const onPop = () => {
      const category: SettingsSection | null = window.history.state?.dscSettingsCategory ?? null;
      const next = parseWorkspaceHash(window.location.hash);
      const nextCategory = next.kind === "settings" && next.section !== "general" ? next.section : category;
      const nextKey = next.kind === "device" ? `device:${next.deviceId}` : next.kind === "settings" ? `settings:${nextCategory ?? "list"}` : next.kind;
      // Closing a sheet does not navigate. It must not reverse the next
      // forward transition, or share scroll state with a settings category.
      backward.current = previousKey.current !== nextKey;
      setSettingsCategory(category);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [setSettingsCategory]);
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      const focused = document.activeElement?.matches("input, textarea, select, [contenteditable=true]");
      setKeyboard(Boolean(focused && viewport.scale <= 1 && window.innerHeight - viewport.height > 140));
      // Pinch zoom is allowed; don't turn a zoomed visual viewport into a
      // fictitious keyboard or squeeze the application's layout beneath it.
      if (viewport.scale <= 1) document.documentElement.style.setProperty("--touch-viewport-height", `${Math.round(viewport.height + viewport.offsetTop)}px`);
    };
    update();
    viewport.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      viewport.removeEventListener("resize", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      document.documentElement.style.removeProperty("--touch-viewport-height");
    };
  }, []);
  const back = () => {
    if (window.history.state?.dscWorkspace && window.history.state?.fromRoute) window.history.back();
    else if (route.kind === "settings") { setSettingsCategory(null); navigate({ kind: "settings", section: "general" }); }
    else navigate({ kind: "devices" });
  };
  const destinations: Array<{ label: string; icon: "overview" | "device" | "settings"; target: WorkspaceRoute; active: boolean }> = [
    { label: "总览", icon: "overview", target: { kind: "overview" }, active: route.kind === "overview" },
    { label: "设备", icon: "device", target: { kind: "devices" }, active: inDevices },
    { label: "设置", icon: "settings", target: { kind: "settings", section: "general" }, active: route.kind === "settings" }
  ];
  const title = route.kind === "device" ? selectedDevice?.hostname ?? "设备详情" : route.kind === "settings" ? "设置" : "观澜";
  const hasBack = route.kind === "device" || (route.kind === "settings" && (!!settingsCategory || route.section !== "general"));
  const emptyDetails = <EmptyState title="选择一台设备" detail="从左侧目录选择设备，查看它的状态、趋势和硬件。" />;
  return <div className={`m3e-theme touch-workspace is-${presentation}${split ? " is-split" : ""}${keyboard ? " is-keyboard-open" : ""}`} data-presentation={presentation}>
    <nav className="touch-navigation" aria-label="主导航">
      <span className="touch-navigation__brand" aria-hidden="true">澜</span>
      {destinations.map((item) => <button type="button" key={item.icon} className={item.active ? "is-selected" : ""} aria-current={item.active ? "page" : undefined}
        onClick={() => { if (item.icon === "settings") setSettingsCategory(null); navigate(item.target); }}><span><Icon name={item.icon} size={24} /></span><strong>{item.label}</strong></button>)}
    </nav>
    <div className="touch-workspace__body">
      <header className="touch-topbar"><div>{hasBack && <M3IconButton label={route.kind === "device" ? "返回上一页" : "返回设置分类"} onClick={back}><Icon name="back" /></M3IconButton>}<strong>{title}</strong></div>
        <M3IconButton label={refreshing ? "正在刷新" : "刷新状态"} disabled={refreshing || mutationPending} onClick={() => void refresh()}><span className={refreshing ? "m3e-spin" : ""}><Icon name="refresh" /></span></M3IconButton>
      </header>
      <SessionRecoveryBanner />
      {snapshot?.source === "cache" && <div className="touch-connection-notice" role="status"><Icon name="clock" size={18} /><span>离线缓存 · {formatDate(snapshot.cache.savedAt)}<small>当前状态待确认，恢复连接后自动同步</small></span></div>}
      {error && snapshot?.source !== "cache" && snapshot && <div className="touch-connection-notice" role="status"><Icon name="warning" size={18}/><span>{error}<small>保留上次数据，请检查数据时间</small></span><Button variant="text" onClick={() => void refresh()}>重试</Button></div>}
      <div className={`touch-workspace__panes${split && inDevices ? " has-directory" : ""}`}>
        <section ref={directory} className="touch-directory-pane" hidden={!showDirectory} aria-label="设备目录" onScroll={(event) => scroll.current.set("directory", event.currentTarget.scrollTop)}>
          <PullToRefresh onRefresh={refresh} disabled={!isTouch || mutationPending}><TouchDevices /></PullToRefresh>
        </section>
        <main ref={main} id="workspace-main-content" className="touch-main-pane" aria-label={title} hidden={!showMain} tabIndex={-1}>
          <RenderBoundary scope="page" resetKey={serializeWorkspaceRoute(route)}>
          {loading && !snapshot ? <LoadingSurface /> : !snapshot ? <ErrorSurface title="暂时无法读取状态" detail={error ?? "请检查网络后重试"} onRetry={() => void refresh()} />
            : route.kind === "device" ? <TouchDetail deviceId={route.deviceId} />
            : route.kind === "settings" ? <TouchSettings split={split} />
            : route.kind === "devices" ? emptyDetails
            : <PullToRefresh onRefresh={refresh} disabled={!isTouch || mutationPending}><TouchOverview /></PullToRefresh>}
          </RenderBoundary>
        </main>
      </div>
    </div>
    <CommandPalette /><ShellNotice />
    {refreshing && <div className="touch-refresh-progress" role="status" aria-label="正在刷新设备状态" />}
    <div className="workspace-visually-hidden" aria-live="polite" aria-atomic="true">{route.kind === "device" && selectedDevice ? `正在查看 ${selectedDevice.hostname}` : ""}</div>
  </div>;
}
