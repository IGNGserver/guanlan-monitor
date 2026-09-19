import React, { useEffect, useRef, useState } from "react";
import type { DeviceSummary } from "@dsc/shared";
import { useWorkspace, type SettingsSection } from "../WorkspaceContext";
import { Button, Icon, Surface } from "../ui";
import { selectDeviceDirectory, type DeviceDirectorySort, type DeviceDirectoryStatus } from "../selectors";
import { mergeDeviceOrder, registerDeviceOrderDraftGuard } from "../deviceOrderDraft";
import { CarbonDeviceTable, ConfirmDialog, DeviceDirectoryFilterBar, EmptyState, ErrorSurface, LoadingSurface, PageIntro } from "./shared";

export function DevicesPage() {
  const { snapshot, allDevices, loading, error, refresh, navigate, deleteInstance, reorderInstances, mutationPending, capabilities } = useWorkspace();
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "device" | "virtual_machine">("all");
  const [statusFilter, setStatusFilter] = useState<DeviceDirectoryStatus>("all");
  const [sort, setSort] = useState<DeviceDirectorySort>("order");
  const [manageMode, setManageMode] = useState(false);
  const [orderDraft, setOrderDraft] = useState<string[] | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeviceSummary | null>(null);
  const serverOrder = allDevices.map((device) => device.deviceId);
  const serverOrderKey = serverOrder.join("\u0000");
  const effectiveOrder = mergeDeviceOrder(orderDraft ?? serverOrder, serverOrder);
  const orderDirty = Boolean(orderDraft && JSON.stringify(effectiveOrder) !== JSON.stringify(serverOrder));
  const orderDirtyRef = useRef(false);
  useEffect(() => {
    const unregisterGuard = registerDeviceOrderDraftGuard(() => orderDirtyRef.current);
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!orderDirtyRef.current) return;
      const proceed = window.confirm("设备顺序修改尚未保存，离开后顺序草稿将丢失。是否继续退出？");
      if (!proceed) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      unregisterGuard();
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);
  useEffect(() => {
    if (!manageMode) {
      setOrderDraft(null);
      return;
    }
    setOrderDraft((current) => current ? mergeDeviceOrder(current, serverOrder) : current);
  }, [manageMode, serverOrderKey]);
  orderDirtyRef.current = orderDirty;
  if (loading && !snapshot) return <LoadingSurface />;
  if (!snapshot) return <ErrorSurface title="无法读取设备目录" detail={error ?? "尚未取得设备快照"} onRetry={() => void refresh()} />;

  const canManage = snapshot.source === "live" && snapshot.session.authenticated;
  const orderPosition = new Map(effectiveOrder.map((deviceId, index) => [deviceId, index]));
  const orderedDevices = allDevices
    .slice()
    .sort((left, right) => (orderPosition.get(left.deviceId) ?? Number.MAX_SAFE_INTEGER) - (orderPosition.get(right.deviceId) ?? Number.MAX_SAFE_INTEGER))
    .map((device, index) => ({ ...device, sortOrder: index }));
  const visibleDevices = selectDeviceDirectory(orderedDevices, { query, instanceType: typeFilter, status: statusFilter, sort: manageMode ? "order" : sort });
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
    const saved = await reorderInstances(effectiveOrder);
    if (saved) {
      setOrderDraft(null);
      setManageMode(false);
    }
  };
  const moveInstance = (deviceId: string, direction: -1 | 1) => {
    if (!canManage || !manageMode || mutationPending) return;
    const current = effectiveOrder;
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
    <DeviceDirectoryFilterBar
      devices={allDevices}
      query={query}
      onQueryChange={setQuery}
      typeFilter={typeFilter}
      onTypeFilterChange={setTypeFilter}
      statusFilter={statusFilter}
      onStatusFilterChange={setStatusFilter}
      sort={sort}
      onSortChange={setSort}
      sortDisabled={manageMode}
      actions={!manageMode ? <Button variant="quiet" onClick={beginManage} disabled={!canManage}>管理顺序</Button> : <div className="workspace-order-actions"><Button variant="primary" onClick={() => void saveManage()} disabled={!orderDirty || mutationPending}>保存顺序</Button><Button variant="quiet" onClick={cancelManage} disabled={mutationPending}>取消</Button></div>}
    />
    {!canManage && <div className="workspace-inline-note" role="status">{snapshot.source === "cache" ? "离线缓存为只读快照。" : "需要实时连接并完成认证后才能删除或调整设备顺序。"}</div>}
    <Surface className="workspace-directory-surface guanlan-data-table-surface">
      <CarbonDeviceTable
        devices={visibleDevices}
        order={effectiveOrder}
        manageMode={manageMode && canManage && !mutationPending}
        onMove={moveInstance}
        onDelete={setDeleteTarget}
        emptyState={<EmptyState title="没有匹配设备" detail="尝试清空搜索或调整类型、状态筛选。" action={<Button variant="quiet" onClick={() => { setQuery(""); setTypeFilter("all"); setStatusFilter("all"); }}>清除筛选</Button>} />}
      />
    </Surface>
    {deleteTarget && <ConfirmDialog title={`删除“${deleteTarget.hostname}”？`} detail="删除后该实例不会继续出现在中枢列表中；下次宿主机或 Agent 再次上报时，它会重新显示。" confirmLabel="删除实例" disabled={mutationPending} onConfirm={() => { const deviceId = deleteTarget.deviceId; setDeleteTarget(null); void deleteInstance(deviceId); }} onCancel={() => setDeleteTarget(null)} />}
  </div>;
}
