import React, { useEffect, useMemo, useRef, useState } from "react";
import type { DeviceSummary } from "@dsc/shared";
import { useWorkspace } from "../WorkspaceContext";
import { useTouchState } from "./TouchState";
import { TouchDeviceRow } from "./TouchDeviceRow";
import { TouchSheet } from "./TouchSheet";
import { M3Chip, M3IconButton, M3SearchBar, M3Select, M3SegmentedControl } from "../m3";
import { Button, Icon } from "../ui";
import {
  normalizeDeviceGroup,
  selectDeviceDirectory,
  selectDeviceGroups,
  selectExistingGroupNames,
  type DeviceDirectorySort,
  type DeviceDirectoryStatus
} from "../selectors";
import { mergeDeviceOrder, registerDeviceOrderDraftGuard } from "../deviceOrderDraft";
import { DeviceGroupDialog, EmptyState, ErrorSurface, LoadingSurface } from "../pages/shared";

export function TouchDevices() {
  const { allDevices, snapshot, loading, error, refresh, route, deleteInstance, reorderInstances, updateDeviceGroup, mutationPending, openSettings, healthThresholds } = useWorkspace();
  const { query, setQuery, status, setStatus, group, setGroup, sort, setSort, pins, togglePin } = useTouchState();
  const [sheet, setSheet] = useState<"filter" | "menu" | null>(null);
  const [target, setTarget] = useState<DeviceSummary | null>(null);
  const [groupTarget, setGroupTarget] = useState<DeviceSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [manage, setManage] = useState(false);
  const [draft, setDraft] = useState<string[] | null>(null);
  const serverOrder = allDevices.map((device) => device.deviceId);
  const effectiveOrder = mergeDeviceOrder(draft ?? serverOrder, serverOrder);
  const dirty = Boolean(manage && draft && effectiveOrder.some((id, index) => id !== serverOrder[index]));
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    const unregister = registerDeviceOrderDraftGuard(() => dirtyRef.current);
    const unload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", unload);
    return () => { unregister(); window.removeEventListener("beforeunload", unload); };
  }, []);
  const routeKey = route.kind === "device" ? `device:${route.deviceId}` : route.kind;
  useEffect(() => { setManage(false); setDraft(null); }, [routeKey]);
  const canManage = snapshot?.source === "live" && snapshot.session.authenticated;
  useEffect(() => { if (!canManage) { setManage(false); setDraft(null); setDeleting(false); } }, [canManage]);
  const ordered = useMemo(() => {
    const positions = new Map(effectiveOrder.map((id, index) => [id, index]));
    return allDevices.map((device) => ({ ...device, sortOrder: positions.get(device.deviceId) ?? 0 }));
  }, [allDevices, effectiveOrder.join("\0")]);
  const groups = useMemo(() => selectDeviceGroups(ordered, healthThresholds), [ordered, healthThresholds]);
  const existingGroupNames = useMemo(() => selectExistingGroupNames(ordered), [ordered]);
  const hasNamedGroups = existingGroupNames.length > 0;
  const activeGroup = group !== "all" && !groups.some((item) => item.key === group) ? "all" : group;
  const visible = selectDeviceDirectory(ordered, {
    query: manage ? "" : query,
    status: manage ? "all" : status,
    group: manage ? "all" : activeGroup,
    sort: manage ? "order" : sort
  });
  const move = (id: string, direction: number) => {
    const position = effectiveOrder.indexOf(id);
    if (!canManage || mutationPending || position + direction < 0 || position + direction >= effectiveOrder.length) return;
    const next = [...effectiveOrder];
    [next[position], next[position + direction]] = [next[position + direction], next[position]];
    setDraft(next);
  };
  const closeSheet = () => {
    if (window.history.state?.dscTouchSheet) { window.history.back(); return; }
    setSheet(null);
  };
  const closeTarget = () => {
    if (window.history.state?.dscTouchSheet) { window.history.back(); return; }
    setTarget(null); setDeleting(false);
  };
  const save = async () => {
    if (!canManage || mutationPending) return;
    if (await reorderInstances(effectiveOrder)) { setManage(false); setDraft(null); }
  };
  if (loading && !snapshot) return <LoadingSurface />;
  if (!snapshot) return <ErrorSurface title="暂时无法读取设备" detail={error ?? "请检查网络后重试"} onRetry={() => void refresh()} />;
  return <div className="touch-page touch-directory">
    <header className="touch-directory__heading"><div><h1>设备</h1><p>{allDevices.length} 台{snapshot?.source === "cache" ? "已缓存" : "已接入"}</p></div>
      {!manage && <M3IconButton label="设备目录操作" onClick={() => setSheet("menu")}><Icon name="more" /></M3IconButton>}
    </header>
    {manage ? <div className="touch-manage-bar" role="status"><p>调整列表顺序<br/><small>用上移、下移调整，保存后同步到中枢。</small></p><div><Button variant="text" disabled={mutationPending} onClick={() => { setManage(false); setDraft(null); }}>取消</Button><Button variant="primary" disabled={!dirty || mutationPending} onClick={() => void save()}>{mutationPending ? "保存中" : "保存顺序"}</Button></div></div>
      : <div className="touch-search-row"><M3SearchBar label="搜索设备" placeholder="搜索名称、分组、系统或标识" value={query} onChange={(event) => setQuery(event.target.value)} onClear={() => setQuery("")} autoComplete="off" enterKeyHint="search" />
        <M3IconButton label="筛选与排序" selected={status !== "all" || activeGroup !== "all" || sort !== "order"} onClick={() => setSheet("filter")}><Icon name="filter" /></M3IconButton></div>}
    {!manage && hasNamedGroups && (
      <div className="touch-group-chips" role="group" aria-label="按分组筛选">
        <M3Chip selected={activeGroup === "all"} onClick={() => setGroup("all")}>全部 ({ordered.length})</M3Chip>
        {groups.map((item) => (
          <M3Chip key={item.key} selected={activeGroup === item.key} onClick={() => setGroup(item.key)}>
            {item.name} ({item.online}/{item.total})
          </M3Chip>
        ))}
      </div>
    )}
    {!manage && <div className="touch-directory__count" aria-live="polite">{query || status !== "all" || activeGroup !== "all" ? `找到 ${visible.length} 台 · ${status === "online" ? "在线" : status === "offline" ? "离线" : "全部状态"}` : "点击设备查看状态与趋势"}</div>}
    <div className="touch-device-list">{visible.map((device, index) => <div key={device.deviceId} className="touch-directory__item">
      <TouchDeviceRow device={device} selected={route.kind === "device" && route.deviceId === device.deviceId} disabled={manage}
        onMore={!manage ? () => { setTarget(device); setDeleting(false); } : undefined} />
      {manage && <div className="touch-order-controls"><span>第 {index + 1} 位</span><M3IconButton label={`上移${device.hostname}`} disabled={!canManage || mutationPending || index === 0} onClick={() => move(device.deviceId, -1)}><Icon name="chevronUp" /></M3IconButton><M3IconButton label={`下移${device.hostname}`} disabled={!canManage || mutationPending || index === visible.length - 1} onClick={() => move(device.deviceId, 1)}><Icon name="chevron" /></M3IconButton></div>}
    </div>)}</div>
    {!visible.length && <EmptyState title={allDevices.length ? "没有匹配的设备" : "还没有设备接入"} detail={allDevices.length ? "清除搜索或筛选后查看全部设备。" : "设备上的 Agent 首次上报后会自动出现在这里。"} action={allDevices.length ? <Button onClick={() => { setQuery(""); setStatus("all"); setGroup("all"); }}>清除筛选</Button> : <Button onClick={() => openSettings("connections")}>查看连接</Button>} />}
    {sheet && <TouchSheet title={sheet === "filter" ? "筛选与排序" : "设备目录"} onClose={closeSheet}>
      {sheet === "filter" ? <div className="touch-sheet__stack"><M3SegmentedControl aria-label="设备状态筛选" options={[{ value: "all", label: "全部" }, { value: "online", label: "在线" }, { value: "offline", label: "离线" }]} value={status} onChange={(value) => setStatus(value as DeviceDirectoryStatus)} />
        <M3Select label="排列方式" value={sort} onChange={(event) => setSort(event.target.value as DeviceDirectorySort)} options={[{ value: "order", label: "中枢顺序" }, { value: "name", label: "设备名称" }, { value: "cpu", label: "CPU 使用率" }, { value: "memory", label: "内存使用率" }, { value: "lastSeen", label: "最近在线" }]} />
        <Button variant="text" onClick={() => { setStatus("all"); setGroup("all"); setSort("order"); }}>重置筛选与排序</Button><Button variant="primary" onClick={closeSheet}>查看 {visible.length} 台设备</Button></div>
      : <div className="touch-sheet__stack"><Button disabled={!canManage || mutationPending} onClick={() => { closeSheet(); setDraft(serverOrder); setManage(true); }}>管理设备顺序</Button><p>{canManage ? "设置分组或删除设备请打开该设备的更多操作。" : "离线缓存只能查看，恢复连接后可管理设备。"}</p></div>}
    </TouchSheet>}
    {target && <TouchSheet title={deleting ? `删除“${target.hostname}”？` : target.hostname} onClose={closeTarget}>
      <div className="touch-sheet__stack">{deleting ? <><p>删除后设备不再出现在中枢列表；宿主机或 Agent 下次上报时，它会重新出现。</p><Button variant="danger" disabled={!canManage || mutationPending} onClick={() => { const id = target.deviceId; closeTarget(); void deleteInstance(id); }}>删除设备</Button><Button variant="text" onClick={() => setDeleting(false)}>取消删除</Button></>
      : <>
          <Button disabled={!canManage || mutationPending} onClick={() => { const device = target; closeTarget(); setGroupTarget(device); }}>
            {normalizeDeviceGroup(target.group) ? `修改分组（当前：${normalizeDeviceGroup(target.group)}）` : "设置分组"}
          </Button>
          <Button onClick={() => { togglePin(target.deviceId); closeTarget(); }}>{pins.includes(target.deviceId) ? "取消常用" : "设为常用设备"}</Button>
          <p>常用设备只保存在当前浏览器，显示在总览中。</p>
          <Button variant="danger" disabled={!canManage || mutationPending} onClick={() => setDeleting(true)}>删除设备</Button>
        </>}</div>
    </TouchSheet>}
    {groupTarget && (
      <DeviceGroupDialog
        title={`设置“${groupTarget.hostname}”的分组`}
        detail="选择已有分组或输入新分组名，留空即可移出分组。"
        currentGroup={normalizeDeviceGroup(groupTarget.group)}
        existingGroups={existingGroupNames}
        disabled={mutationPending}
        onConfirm={(nextGroup) => {
          const deviceId = groupTarget.deviceId;
          setGroupTarget(null);
          void updateDeviceGroup([deviceId], nextGroup);
        }}
        onCancel={() => setGroupTarget(null)}
      />
    )}
  </div>;
}
