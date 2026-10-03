"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Icon, M3Button, M3Dialog, hasDeviceOrderDraft } from "@dsc/console-ui";

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
export function PwaControls({ onForget }: { onForget: () => Promise<void> }) {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [deferredInstall, setDeferredInstall] = useState<InstallPrompt | null>(null);
  const [open, setOpen] = useState(false);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const [feedback, setFeedback] = useState("");
  const requestedUpdate = useRef(false);
  const helpId = useId();
  const helpLifecycle = useRef({ version: 0 });
  useEffect(() => {
    if (!open) return;
    const lifecycle = helpLifecycle.current;
    const version = ++lifecycle.version;
    if (window.history.state?.dscPwaHelp !== helpId) window.history.pushState({ ...window.history.state, dscPwaHelp: helpId }, "");
    const back = () => { if (window.history.state?.dscPwaHelp !== helpId) setOpen(false); };
    window.addEventListener("popstate", back);
    return () => {
      window.removeEventListener("popstate", back);
      queueMicrotask(() => { if (lifecycle.version === version && window.history.state?.dscPwaHelp === helpId) window.history.back(); });
    };
  }, [open, helpId]);
  const dirtyFields = useRef(new Set<HTMLInputElement | HTMLTextAreaElement>());
  useEffect(() => {
    const show = () => setOpen(true);
    const install = (event: Event) => { event.preventDefault(); setDeferredInstall(event as InstallPrompt); };
    const installed = () => setDeferredInstall(null);
    const onInput = (event: Event) => {
      const field = event.target;
      if ((field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) && !field.closest(".m3e-search-bar")) {
        if (field.value) dirtyFields.current.add(field);
        else dirtyFields.current.delete(field);
      }
    };
    window.addEventListener("dsc-pwa-settings", show);
    window.addEventListener("beforeinstallprompt", install);
    window.addEventListener("appinstalled", installed);
    document.addEventListener("input", onInput);
    return () => {
      window.removeEventListener("dsc-pwa-settings", show);
      window.removeEventListener("beforeinstallprompt", install);
      window.removeEventListener("appinstalled", installed);
      document.removeEventListener("input", onInput);
    };
  }, []);
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !window.isSecureContext || !("serviceWorker" in navigator)) return;
    let active = true;
    let registration: ServiceWorkerRegistration | null = null;
    const workers = new Set<ServiceWorker>();
    const onState = () => {
      if (active && registration?.waiting && navigator.serviceWorker.controller) { setWaiting(registration.waiting); setUpdateDismissed(false); }
    };
    const found = () => {
      const worker = registration?.installing;
      if (worker) { workers.add(worker); worker.addEventListener("statechange", onState); }
    };
    const controller = () => { if (requestedUpdate.current) window.location.reload(); };
    navigator.serviceWorker.addEventListener("controllerchange", controller);
    void navigator.serviceWorker.register(`/sw.js?revision=${process.env.NEXT_PUBLIC_DSC_PWA_REVISION}`, { scope: "/", updateViaCache: "none" }).then((value) => {
      if (!active) return;
      registration = value;
      onState(); found();
      value.addEventListener("updatefound", found);
    }).catch(() => { /* A refused/failed worker leaves live browsing available. */ });
    const foreground = () => { if (!document.hidden && navigator.onLine) void registration?.update().catch(() => undefined); };
    document.addEventListener("visibilitychange", foreground);
    return () => {
      active = false;
      navigator.serviceWorker.removeEventListener("controllerchange", controller);
      document.removeEventListener("visibilitychange", foreground);
      registration?.removeEventListener("updatefound", found);
      for (const worker of workers) worker.removeEventListener("statechange", onState);
    };
  }, []);
  const update = () => {
    const dirty = hasDeviceOrderDraft() || [...dirtyFields.current].some((field) => field.isConnected && !!field.value);
    if (dirty && !window.confirm("更新会重新打开页面。请先保存当前输入；现在继续更新吗？")) return;
    if (!waiting || waiting.state !== "installed") { setFeedback("更新尚未就绪，请稍后重试。"); return; }
    requestedUpdate.current = true;
    setUpdating(true);
    waiting.postMessage({ type: "ACTIVATE_UPDATE" });
  };
  const install = async () => {
    if (!deferredInstall) return;
    await deferredInstall.prompt();
    const result = await deferredInstall.userChoice;
    setFeedback(result.outcome === "accepted" ? "已请求安装，可从主屏幕打开观澜。" : "已保留浏览器使用方式。");
    setDeferredInstall(null);
  };
  return <>
    {waiting && !updateDismissed && <aside className="pwa-update-notice" role="status"><span><Icon name="download" size={20}/><strong>观澜有可用更新</strong></span><div><M3Button variant="text" disabled={updating} onClick={() => setUpdateDismissed(true)}>稍后</M3Button><M3Button disabled={updating} onClick={update}>{updating ? "正在更新" : "更新并打开"}</M3Button></div></aside>}
    <M3Dialog open={open} onClose={() => setOpen(false)} headline="安装与离线使用" icon="download" className="pwa-dialog" actions={<M3Button variant="text" onClick={() => setOpen(false)}>完成</M3Button>}>
      <div className="pwa-help">{typeof window !== "undefined" && !window.isSecureContext && <p>当前地址不支持离线启动；通过 HTTPS 打开后可启用此功能。</p>}<p>添加到主屏幕后，可以从独立窗口打开观澜。</p>
        {deferredInstall ? <M3Button onClick={() => void install()}>安装观澜</M3Button> : <p>iPhone / iPad：在 Safari 的分享菜单选择“添加到主屏幕”。其他浏览器：在菜单中查找“安装应用”或“添加到主屏幕”。</p>}
        <p>此浏览器中的离线快照有效期最长 24 小时。离线时可查看缓存、搜索和切换已缓存的详情；当前状态会标为待确认，管理操作暂停。</p>
        <p>共享设备使用后，可清除本地离线数据。退出或会话失效时也会自动清除；访问密钥不会进入缓存。</p>
        <M3Button variant="outlined" disabled={forgetting} onClick={() => { setForgetting(true); void onForget().then(() => { setFeedback("已清除本地离线数据。"); setOpen(false); }).finally(() => setForgetting(false)); }}>清除本地离线数据</M3Button>
        {waiting && <M3Button disabled={updating} onClick={update}>{updating ? "正在更新" : "更新并重新打开"}</M3Button>}
        {feedback && <p role="status">{feedback}</p>}
      </div>
    </M3Dialog>
  </>;
}
