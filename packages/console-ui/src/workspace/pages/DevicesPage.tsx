import React, { useEffect, useState } from "react";
import type { DeviceSummary } from "@dsc/shared";
import { useWorkspace, type SettingsSection } from "../WorkspaceContext";
import { Button, Icon, Surface } from "../ui";
import { M3Chip, M3SegmentedControl, M3Select, M3TextField } from "../m3";
import { selectDeviceDirectory, type DeviceDirectorySort, type DeviceDirectoryStatus } from "../selectors";
import { DeviceRow, EmptyState, ErrorSurface, LoadingSurface, PageIntro, ConfirmDialog } from "./shared";

export function DevicesPage() {
  const { snapshot, allDevices, loading, error, refresh, navigate, deleteInstance, reorderInstances, mutationPending, capabilities } = useWorkspace();
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "device" | "virtual_machine">("all");
  const [statusFilter, setStatusFilter] = useState<DeviceDirectoryStatus>("all");
  const [sort, setSort] = useState<DeviceDirectorySort>("order");
  const [manageMode, setManageMode] = useState(false);
  const [orderDraft, setOrderDraft] = useState<string[] | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeviceSummary | null>(null);
  useEffect(() => {
    if (!manageMode) setOrderDraft(null);
  }, [allDevices, manageMode]);
  if (loading && !snapshot) return <LoadingSurface />;
  if (!snapshot) return <ErrorSurface title="无法读取设备目录" detail={error ?? "尚未取得设备快照"} onRetry={() => void refresh()} />;

  const canManage = snapshot.source === "live" && snapshot.session.authenticated;
  const serverOrder = allDevices.map((device) => device.deviceId);
  const effectiveOrder = orderDraft ?? serverOrder;
  const orderPosition = new Map(effectiveOrder.map((deviceId, index) => [deviceId, index]));
  const orderedDevices = allDevices
    .slice()
    .sort((left, right) => (orderPosition.get(left.deviceId) ?? Number.MAX_SAFE_INTEGER) - (orderPosition.get(right.deviceId) ?? Number.MAX_SAFE_INTEGER))
    .map((device, index) => ({ ...device, sortOrder: index }));
  const visibleDevices = selectDeviceDirectory(orderedDevices, { query, instanceType: typeFilter, status: statusFilter, sort: manageMode ? "order" : sort });
  const orderDirty = Boolean(orderDraft && JSON.stringify(orderDraft) !== JSON.stringify(serverOrder));
  const beginManage = () => {
    if (!canManage || mutationPending) return;
    setOrderDraft(serverOrder);
    setSort("order");
    setManageMode(true);
  };
  const cancelManage = () => {
    if (mutationPending) return;
    setOrderDraft(null);
    setManageMode(false);
  };
  const saveManage = async () => {
    if (!canManage || !orderDraft || mutationPending) return;
    const saved = await reorderInstances(orderDraft);
    if (saved) {
      setOrderDraft(null);
      setManageMode(false);
    }
  };
  const moveInstance = (deviceId: string, direction: -1 | 1) => {
    if (!canManage || !manageMode || mutationPending) return;
    const current = orderDraft ?? serverOrder;
    const currentIndex = current.indexOf(deviceId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= current.length) return;
    const next = [...current];
    [next[currentIndex], next[nextIndex]] = [next[nextIndex], next[currentIndex]];
    setOrderDraft(next);
  };
  const settingsSection: SettingsSection = capabilities.canConfigureConnection ? "connections" : "workspace";

  return <div className="workspace-page workspace-page--devices">
    <PageIntro
      eyebrow="设备"
      title="全部设备"
      description={snapshot.source === "cache" ? "当前显示离线缓存；筛选和查看可用，但管理操作已禁用。" : "浏览、筛选和管理接入当前中枢的全部实例。"}
      actions={<Button variant="quiet" onClick={() => navigate({ kind: "hub", hubId: "primary" })}><Icon name="hub" size={16} />查看中枢</Button>}
    />
    <div className="workspace-directory-toolbar">
      <M3TextField label="搜索设备" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名称、设备 ID、系统或宿主机" type="search" />
      <M3SegmentedControl options={[{ value: "all", label: "全部类型" }, { value: "device", label: "普通设备" }, { value: "virtual_machine", label: "虚拟机" }]} value={typeFilter} onChange={(value) => setTypeFilter(value as typeof typeFilter)} aria-label="设备类型" />
      <div className="workspace-directory-toolbar__chips" aria-label="设备状态">
        <M3Chip selected={statusFilter === "all"} onClick={() => setStatusFilter("all")}>全部 {allDevices.length}</M3Chip>
        <M3Chip selected={statusFilter === "online"} onClick={() => setStatusFilter("online")}>在线 {allDevices.filter((device) => device.status === "online").length}</M3Chip>
        <M3Chip selected={statusFilter === "offline"} onClick={() => setStatusFilter("offline")}>离线 {allDevices.filter((device) => device.status !== "online").length}</M3Chip>
      </div>
      <M3Select label="排序" hideLabel value={sort} onChange={(event) => setSort(event.target.value as DeviceDirectorySort)} disabled={manageMode} options={[{ value: "order", label: "中枢顺序" }, { value: "name", label: "名称" }, { value: "cpu", label: "CPU" }, { value: "memory", label: "内存" }, { value: "lastSeen", label: "最近响应" }]} />
      {!manageMode ? <Button variant="quiet" onClick={beginManage} disabled={!canManage}>管理顺序</Button> : <div className="workspace-order-actions"><Button variant="primary" onClick={() => void saveManage()} disabled={!orderDirty || mutationPending}>保存顺序</Button><Button variant="quiet" onClick={cancelManage} disabled={mutationPending}>取消</Button></div>}
    </div>
    {!canManage && <div className="workspace-inline-note" role="status">{snapshot.source === "cache" ? "离线缓存为只读快照。" : "需要实时连接并完成认证后才能删除或调整设备顺序。"}</div>}
    <Surface className="workspace-directory-surface">
      <div className="workspace-directory-head" role="row">
        <span>设备</span><span>状态</span><span>CPU</span><span>内存</span><span>磁盘</span><span>操作</span>
      </div>
      <div className="workspace-device-rows" role="rowgroup">
        {visibleDevices.length ? visibleDevices.map((device, index) => <DeviceRow
          key={device.deviceId}
          device={device}
          index={index}
          total={visibleDevices.length}
          onMove={manageMode && canManage && !mutationPending ? (direction) => moveInstance(device.deviceId, direction) : undefined}
          onDelete={manageMode && canManage && !mutationPending ? () => setDeleteTarget(device) : undefined}
        />) : <EmptyState title="没有匹配设备" detail="尝试清空搜索或调整类型、状态筛选。" action={<Button variant="quiet" onClick={() => { setQuery(""); setTypeFilter("all"); setStatusFilter("all"); }}>清除筛选</Button>} />}
      </div>
    </Surface>
    {deleteTarget && <ConfirmDialog title={`删除“${deleteTarget.hostname}”？`} detail="删除后该实例不会继续出现在中枢列表中；下次宿主机或 Agent 再次上报时，它会重新显示。" confirmLabel="删除实例" disabled={mutationPending} onConfirm={() => { const deviceId = deleteTarget.deviceId; setDeleteTarget(null); void deleteInstance(deviceId); }} onCancel={() => setDeleteTarget(null)} />}
  </div>;
}
