import React from "react";
import { useWorkspace } from "../WorkspaceContext";
import { M3Button, M3IconButton } from "../m3";
import { Button, Icon, StatusLabel } from "../ui";
import { selectSnapshotSource } from "../selectors";

export function AppTopBar() {
  const { snapshot, refreshing, mutationPending, refresh, setCommandOpen, sidebarCollapsed, setSidebarCollapsed, openSettings, capabilities } = useWorkspace();
  const source = snapshot ? selectSnapshotSource(snapshot, snapshot.devices) : "unknown";
  const sourceState = source === "live" ? "online" : source === "cache" ? "cached" : source === "unknown" ? "offline" : "unknown";
  return <header className="workspace-topbar">
    <div className="workspace-topbar__leading">
      <M3IconButton className="workspace-icon-button workspace-topbar__toggle" label="切换侧边栏" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}><Icon name="collapse" /></M3IconButton>
      {!capabilities.canControlNativeWindow && <strong className="workspace-topbar__brand">观澜</strong>}
    </div>
    <div className="workspace-topbar__actions">
      <StatusLabel state={sourceState} />
      <M3Button className="workspace-search-trigger" variant="outlined" leadingIcon={<Icon name="search" />} aria-label="查找设备、页面或设置" title="查找设备、页面或设置" onClick={() => setCommandOpen(true)}><span>查找设备、页面或设置</span><kbd>/</kbd></M3Button>
      {/* The visible word disappears while refreshing, so the button carries a permanent accessible name instead of degrading to a bare icon whose only text was the tooltip. */}
      <Button variant="quiet" onClick={() => void refresh()} disabled={refreshing || mutationPending} aria-label={refreshing ? "正在刷新" : mutationPending ? "正在保存更改" : "刷新状态"} title={mutationPending ? "正在保存更改" : "刷新状态"}><Icon name="refresh" size={16} />{!refreshing && <span>{mutationPending ? "保存中" : "刷新"}</span>}</Button>
      <Button variant="quiet" onClick={() => openSettings()} aria-label="设置" title="设置"><Icon name="settings" size={16} /></Button>
    </div>
  </header>;
}
export function SessionRecoveryBanner() {
  const { capabilities, snapshot, refresh, refreshing } = useWorkspace();
  if (capabilities.canConfigureConnection || snapshot?.source !== "empty" || snapshot.session.authenticated) return null;
  const desktop = capabilities.canControlNativeWindow;
  return <section className="workspace-session-recovery m3-inline-banner" role="alert" aria-live="assertive">
    <div className="workspace-session-recovery__copy"><strong>{desktop ? "尚未连接到中枢" : "浏览器会话已失效"}</strong><p>{desktop ? "当前没有可读取的设备状态；请在连接设置中确认中枢地址与访问密钥。" : "当前数据已停止同步；重新认证后才能继续查看设备和指标。"}</p></div>
    <div className="workspace-form__actions">{desktop ? <Button variant="primary" onClick={() => window.location.assign("#settings/connections")}>打开连接设置</Button> : <Button variant="primary" onClick={() => window.location.reload()}>重新认证</Button>}<Button variant="quiet" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? "正在检查" : "重新检查"}</Button></div>
  </section>;
}

export function ShellNotice() {
  const { notice } = useWorkspace();
  if (!notice) return null;
  return <div className={`workspace-toast m3-snackbar m3-snackbar--${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>{notice.text}</div>;
}
