import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RECOMMENDED_DEVICE_GROUPS } from "../selectors";
import type { DeviceSummary, SamplePoint } from "@dsc/shared";
import { useWorkspace } from "../WorkspaceContext";
import { CapacityBar, Sparkline } from "../charts";
import { M3Badge, M3Chip, useRipple } from "../m3";
import { Button, Icon, StatusDot, Surface } from "../ui";
import { formatPercent, formatRate } from "../formatters";
import { metricTone, type HealthThresholds } from "../health";
import {
  selectGroupFleetTrends,
  selectGroupNetworkRates,
  type GroupNetworkRateSummary
} from "../fleetTrends";
import {
  isDeviceGroupDragEvent,
  readDroppedDeviceIds
} from "../deviceGroupDnd";
import {
  normalizeDeviceGroup,
  selectDeviceDirectory,
  selectDeviceGroups,
  selectExistingGroupNames,
  sortDevicesByCriterion,
  type DeviceDirectorySort,
  type DeviceDirectoryStatus,
  type DeviceGroupFilter,
  type DeviceGroupSummary
} from "../selectors";
import { mergeDeviceOrder, registerDeviceOrderDraftGuard } from "../deviceOrderDraft";
import {
  GroupHealthBar,
  GroupScopeTelemetryStrip,
  GroupedCardSwimlanes,
  formatGroupPoolCaption
} from "./GroupVisuals";
import {
  DeviceTable,
  ConfirmDialog,
  PromptDialog,
  DeviceGroupDialog,
  BatchGroupManageDialog,
  DeviceDirectoryFilterBar,
  EmptyState,
  ErrorSurface,
  LoadingSurface,
  PageIntro,
  SnapshotFreshnessNotice,
  type DirectoryViewMode
} from "./shared";

const COLLAPSED_GROUPS_STORAGE_KEY = "dsc-collapsed-groups";
const VIEW_MODE_STORAGE_KEY = "dsc-directory-view-mode";
const GROUP_GUIDE_DISMISSED_KEY = "dsc-group-guide-dismissed";

const WINDOW_LABELS: Record<string, string> = {
  "1m": "1 分钟",
  "5m": "5 分钟",
  "15m": "15 分钟",
  "1h": "1 小时",
  "6h": "6 小时",
  "24h": "1 天",
  "1d": "1 天",
  "7d": "1 周",
  "1w": "1 周"
};

/** Preserves directory search/status/sort across DeviceDetailsPage round-trips within the session. */
const directorySessionMemory: {
  query: string;
  status: DeviceDirectoryStatus;
  sort: DeviceDirectorySort;
} = {
  query: "",
  status: "all",
  sort: "order"
};

function readCollapsedGroups(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(COLLAPSED_GROUPS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? new Set(parsed.filter((item): item is string => typeof item === "string")) : new Set();
  } catch {
    return new Set();
  }
}

function storeCollapsedGroups(groups: ReadonlySet<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COLLAPSED_GROUPS_STORAGE_KEY, JSON.stringify([...groups]));
  } catch {
    /* Optional preference. */
  }
}

function readStoredViewMode(): DirectoryViewMode {
  if (typeof window === "undefined") return "grouped";
  try {
    const raw = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    return raw === "cards" || raw === "table" || raw === "grouped" ? raw : "grouped";
  } catch {
    return "grouped";
  }
}

function readGuideDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(GROUP_GUIDE_DISMISSED_KEY) === "true";
  } catch {
    return false;
  }
}

export function DevicesPage() {
  const {
    route,
    navigate,
    snapshot,
    allDevices,
    metricsWindow,
    loading,
    error,
    refresh,
    deleteInstance,
    reorderInstances,
    updateDeviceGroup,
    syncDeviceGroupMembers,
    mutationPending,
    openSettings,
    healthThresholds,
    isTouch
  } = useWorkspace();

  const overviewInstances = snapshot?.overviewMetrics?.instances;
  const cpuTrends = useMemo(
    () => new Map((overviewInstances ?? []).map((instance) => [instance.deviceId, instance.cpuUsagePercent])),
    [overviewInstances]
  );
  const routeGroup = route.kind === "devices" && route.group ? route.group : "all";

  const [query, setQueryState] = useState(() => directorySessionMemory.query);
  const [statusFilter, setStatusFilterState] = useState<DeviceDirectoryStatus>(() => directorySessionMemory.status);
  const [groupFilter, setGroupFilter] = useState<DeviceGroupFilter>(routeGroup);
  const [sort, setSortState] = useState<DeviceDirectorySort>(() => directorySessionMemory.sort);
  const [viewMode, setViewModeState] = useState<DirectoryViewMode>(readStoredViewMode);
  const [guideDismissed, setGuideDismissed] = useState<boolean>(readGuideDismissed);

  const setQuery = useCallback((next: string) => {
    directorySessionMemory.query = next;
    setQueryState(next);
  }, []);
  const setStatusFilter = useCallback((next: DeviceDirectoryStatus) => {
    directorySessionMemory.status = next;
    setStatusFilterState(next);
  }, []);
  const setSort = useCallback((next: DeviceDirectorySort) => {
    directorySessionMemory.sort = next;
    setSortState(next);
  }, []);
  const setViewMode = useCallback((next: DirectoryViewMode) => {
    setViewModeState(next);
    try {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, next);
    } catch {
      /* Optional preference. */
    }
  }, []);

  const [manageMode, setManageMode] = useState(false);
  const [orderDraft, setOrderDraft] = useState<string[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(readCollapsedGroups);
  const [deleteTarget, setDeleteTarget] = useState<DeviceSummary | null>(null);
  const [groupTargetIds, setGroupTargetIds] = useState<string[] | null>(null);
  const [batchDialogState, setBatchDialogState] = useState<{ initialGroup: string | null; preselectedIds?: string[] } | null>(null);
  const [renamingGroup, setRenamingGroup] = useState<DeviceGroupSummary | null>(null);
  const [dissolvingGroup, setDissolvingGroup] = useState<DeviceGroupSummary | null>(null);
  const pendingGroupTransitionRef = useRef<string | null>(null);

  useEffect(() => {
    setGroupFilter(routeGroup);
  }, [routeGroup]);

  const changeGroupFilter = useCallback((nextGroup: DeviceGroupFilter) => {
    setGroupFilter(nextGroup);
    if (route.kind === "devices") {
      const normalized = nextGroup === "all" ? undefined : nextGroup;
      if (route.group !== normalized) {
        navigate(normalized ? { kind: "devices", group: normalized } : { kind: "devices" });
      }
    }
  }, [navigate, route]);

  // Keep multi-selection free of stale device IDs when devices are removed.
  useEffect(() => {
    const validIds = new Set(allDevices.map((d) => d.deviceId));
    setSelectedIds((current) => {
      if (current.size === 0) return current;
      let changed = false;
      const next = new Set<string>();
      for (const id of current) {
        if (validIds.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : current;
    });
  }, [allDevices]);

  const serverOrder = useMemo(() => allDevices.map((device) => device.deviceId), [allDevices]);
  const serverOrderKey = useMemo(() => serverOrder.join("\u0000"), [serverOrder]);
  const effectiveOrder = useMemo(() => mergeDeviceOrder(orderDraft ?? serverOrder, serverOrder), [orderDraft, serverOrder]);
  const orderDirty = useMemo(
    () => Boolean(orderDraft && effectiveOrder.length === serverOrder.length && effectiveOrder.some((id, index) => id !== serverOrder[index])),
    [orderDraft, effectiveOrder, serverOrder]
  );
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
    setOrderDraft((current) => (current ? mergeDeviceOrder(current, serverOrder) : current));
  }, [manageMode, serverOrderKey]);
  orderDirtyRef.current = orderDirty;

  const orderPosition = useMemo(() => new Map(effectiveOrder.map((deviceId, index) => [deviceId, index])), [effectiveOrder]);
  const orderedDevices = useMemo(
    () =>
      allDevices
        .slice()
        .sort((left, right) => (orderPosition.get(left.deviceId) ?? Number.MAX_SAFE_INTEGER) - (orderPosition.get(right.deviceId) ?? Number.MAX_SAFE_INTEGER))
        .map((device, index) => ({ ...device, sortOrder: index })),
    [allDevices, orderPosition]
  );

  const allGroups = useMemo(() => selectDeviceGroups(orderedDevices, healthThresholds), [orderedDevices, healthThresholds]);
  const existingGroupNames = useMemo(() => selectExistingGroupNames(orderedDevices), [orderedDevices]);
  const hasNamedGroups = existingGroupNames.length > 0;

  useEffect(() => {
    if (allGroups.some((group) => group.key === pendingGroupTransitionRef.current)) {
      pendingGroupTransitionRef.current = null;
    }
    if (
      groupFilter !== "all"
      && groupFilter !== pendingGroupTransitionRef.current
      && allDevices.length > 0
      && !allGroups.some((group) => group.key === groupFilter)
    ) {
      setGroupFilter("all");
      if (route.kind === "devices" && route.group) {
        navigate({ kind: "devices" });
      }
    }
  }, [allDevices.length, allGroups, groupFilter, navigate, route]);

  const activeGroupSummary = useMemo(
    () => (groupFilter === "all" ? null : allGroups.find((group) => group.key === groupFilter) ?? null),
    [allGroups, groupFilter]
  );

  const scopedCounts = useMemo(() => {
    if (!activeGroupSummary) return undefined;
    return {
      total: activeGroupSummary.total,
      online: activeGroupSummary.online,
      offline: activeGroupSummary.offline
    };
  }, [activeGroupSummary]);

  const effectiveSort: DeviceDirectorySort = manageMode ? "order" : sort;

  const visibleDevices = useMemo(
    () =>
      selectDeviceDirectory(orderedDevices, {
        query,
        status: statusFilter,
        group: groupFilter,
        sort: effectiveSort
      }),
    [effectiveSort, groupFilter, orderedDevices, query, statusFilter]
  );

  // Preserve group sections even when sorting by CPU / Memory / Disk / Name!
  const visibleGroups = useMemo(() => {
    const rawGroups = selectDeviceGroups(visibleDevices, healthThresholds);
    if (effectiveSort === "order") return rawGroups;
    return rawGroups.map((group) => ({
      ...group,
      devices: sortDevicesByCriterion(group.devices, effectiveSort)
    }));
  }, [effectiveSort, healthThresholds, visibleDevices]);

  const groupNetworkRates = useMemo(
    () => selectGroupNetworkRates(overviewInstances, allGroups),
    [allGroups, overviewInstances]
  );
  const groupCpuTrends = useMemo(() => {
    const selection = selectGroupFleetTrends(overviewInstances ?? [], allGroups, "cpu");
    return new Map(selection.trends.map((item) => [item.groupKey, item.points]));
  }, [allGroups, overviewInstances]);

  if (loading && !snapshot) return <LoadingSurface />;
  if (!snapshot) return <ErrorSurface title="无法读取设备目录" detail={error ?? "尚未取得设备快照"} onRetry={() => void refresh()} />;

  const canManage = snapshot.source === "live" && snapshot.session.authenticated;
  const canDragToGroup = canManage && !mutationPending && !isTouch && !manageMode;
  const windowLabel = WINDOW_LABELS[metricsWindow] ?? metricsWindow;

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

  // Swap with the adjacent device in the currently visible sequence so filtered/scoped reordering works predictably.
  const moveInstance = (deviceId: string, direction: -1 | 1) => {
    if (!canManage || !manageMode || mutationPending) return;
    const visibleIndex = visibleDevices.findIndex((d) => d.deviceId === deviceId);
    const neighbor = visibleDevices[visibleIndex + direction];
    if (visibleIndex < 0 || !neighbor) return;
    const current = effectiveOrder;
    const fromIdx = current.indexOf(deviceId);
    const toIdx = current.indexOf(neighbor.deviceId);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = [...current];
    [next[fromIdx], next[toIdx]] = [next[toIdx], next[fromIdx]];
    setOrderDraft(next);
  };

  const toggleSelectDevice = (deviceId: string, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(deviceId);
      else next.delete(deviceId);
      return next;
    });
  };
  const selectDeviceBatch = (deviceIds: string[], checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of deviceIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const toggleGroupCollapse = (groupKey: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      storeCollapsedGroups(next);
      return next;
    });
  };

  const isSearching = query.trim().length > 0;
  const isGroupCollapsed = (groupKey: string) => !isSearching && groupFilter === "all" && collapsedGroups.has(groupKey);

  const allVisibleGroupsCollapsed = visibleGroups.length > 0 && visibleGroups.every((group) => collapsedGroups.has(group.key));
  const toggleAllGroupsCollapse = () => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (allVisibleGroupsCollapsed) {
        visibleGroups.forEach((group) => next.delete(group.key));
      } else {
        visibleGroups.forEach((group) => next.add(group.key));
      }
      storeCollapsedGroups(next);
      return next;
    });
  };

  const handleDropDevicesToGroup = (deviceIds: string[], targetGroup: string | null) => {
    if (!canManage || mutationPending || !deviceIds.length) return;
    const targetNorm = normalizeDeviceGroup(targetGroup);
    const changed = deviceIds.filter((id) => {
      const dev = allDevices.find((item) => item.deviceId === id);
      return dev && normalizeDeviceGroup(dev.group) !== targetNorm;
    });
    if (!changed.length) return;
    void updateDeviceGroup(changed, targetNorm).then((ok) => {
      if (ok) setSelectedIds(new Set());
    });
  };

  const groupDialogDevices = groupTargetIds
    ? allDevices.filter((device) => groupTargetIds.includes(device.deviceId))
    : [];
  const groupDialogCurrentGroup = groupDialogDevices.length === 1
    ? normalizeDeviceGroup(groupDialogDevices[0].group)
    : groupDialogDevices.length > 1 && new Set(groupDialogDevices.map((d) => normalizeDeviceGroup(d.group))).size === 1
      ? normalizeDeviceGroup(groupDialogDevices[0].group)
      : null;

  const selectedDevices = allDevices.filter((d) => selectedIds.has(d.deviceId));
  const anySelectedHasGroup = selectedDevices.some((d) => normalizeDeviceGroup(d.group) !== null);

  const emptyDirectory = allDevices.length
    ? <EmptyState
        title="没有匹配设备"
        detail={`${allDevices.length} 台已接入设备里没有符合当前搜索或筛选的；清除后即可看到全部设备。`}
        action={<Button variant="quiet" onClick={() => { setQuery(""); setStatusFilter("all"); changeGroupFilter("all"); }}>清除筛选</Button>}
      />
    : <EmptyState
        title="还没有设备接入"
        detail="目标设备上的 Agent 上报一次后，就会自动出现在这里；也可以先检查中枢连接。"
        action={<Button variant="primary" onClick={() => openSettings("connections")}>连接设置</Button>}
      />;

  // When viewing all groups (`groupFilter === "all"`) and named groups exist:
  // `viewMode === "grouped"` shows aligned collapsible group sections (even when sorted!);
  // `viewMode === "cards"` shows group swimlanes; `viewMode === "table"` shows flat table.
  const effectiveViewMode: DirectoryViewMode = !hasNamedGroups || manageMode ? "table" : viewMode;
  const showGroupedTableSections =
    hasNamedGroups && !manageMode && groupFilter === "all" && effectiveViewMode === "grouped" && visibleGroups.length > 0;
  const showGroupCardSwimlanes =
    hasNamedGroups && !manageMode && effectiveViewMode === "cards" && visibleGroups.length > 0;

  let expandedSectionCounter = 0;

  return (
    <div className="workspace-page workspace-page--devices">
      <PageIntro
        eyebrow={activeGroupSummary ? "设备 · 设备组" : "设备"}
        title={activeGroupSummary ? activeGroupSummary.name : "全部设备"}
        description={
          snapshot.source === "cache"
            ? "当前显示离线缓存；可以搜索和查看，管理操作已禁用。"
            : activeGroupSummary
              ? [
                  `组内 ${activeGroupSummary.online}/${activeGroupSummary.total} 台在线`,
                  activeGroupSummary.offline > 0 ? `${activeGroupSummary.offline} 台离线` : "",
                  activeGroupSummary.overThreshold > 0 ? `${activeGroupSummary.overThreshold} 台超限` : "",
                  activeGroupSummary.memoryTotalBytes
                    ? `内存池 ${formatGroupPoolCaption(activeGroupSummary.memoryUsedBytes, activeGroupSummary.memoryTotalBytes)}`
                    : activeGroupSummary.avgMemoryPercent != null
                      ? `平均内存 ${formatPercent(activeGroupSummary.avgMemoryPercent)}`
                      : ""
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "搜索、按组对比资源池、拖拽或勾选多台设备快速管理分组。"
        }
        actions={
          activeGroupSummary ? (
            <>
              <Button variant="quiet" onClick={() => changeGroupFilter("all")}>
                返回全部组
              </Button>
              {canManage && !activeGroupSummary.isUngrouped && (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => setBatchDialogState({ initialGroup: activeGroupSummary.name })}
                    disabled={mutationPending}
                  >
                    <Icon name="add" size={15} />管理成员
                  </Button>
                  <Button variant="quiet" onClick={() => setRenamingGroup(activeGroupSummary)} disabled={mutationPending}>
                    <Icon name="edit" size={15} />重命名
                  </Button>
                  <Button variant="quiet" onClick={() => setDissolvingGroup(activeGroupSummary)} disabled={mutationPending}>
                    解散分组
                  </Button>
                </>
              )}
              {canManage && activeGroupSummary.isUngrouped && (
                <Button
                  variant="secondary"
                  onClick={() =>
                    setBatchDialogState({
                      initialGroup: null,
                      preselectedIds: activeGroupSummary.devices.map((d) => d.deviceId)
                    })
                  }
                  disabled={mutationPending}
                >
                  <Icon name="add" size={15} />批量归入分组
                </Button>
              )}
            </>
          ) : canManage && !manageMode && allDevices.length > 0 ? (
            <Button
              variant={hasNamedGroups ? "secondary" : "primary"}
              onClick={() =>
                setBatchDialogState({
                  initialGroup: null,
                  preselectedIds: selectedIds.size > 0 ? [...selectedIds] : undefined
                })
              }
              disabled={mutationPending}
            >
              <Icon name="add" size={15} />
              {hasNamedGroups ? "新建 / 批量分组" : "新建分组"}
            </Button>
          ) : undefined
        }
      />
      <SnapshotFreshnessNotice />

      {activeGroupSummary && (
        <GroupScopeTelemetryStrip
          group={activeGroupSummary}
          thresholds={healthThresholds}
          networkRate={groupNetworkRates.get(activeGroupSummary.key)}
          cpuSparkline={groupCpuTrends.get(activeGroupSummary.key)}
        />
      )}

      <DeviceDirectoryFilterBar
        devices={orderedDevices}
        scopedCounts={scopedCounts}
        query={query}
        onQueryChange={setQuery}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        groupFilter={groupFilter}
        onGroupFilterChange={changeGroupFilter}
        groups={allGroups}
        sort={sort}
        onSortChange={setSort}
        sortDisabled={manageMode}
        viewMode={hasNamedGroups && !manageMode ? effectiveViewMode : undefined}
        onViewModeChange={hasNamedGroups && !manageMode ? setViewMode : undefined}
        allGroupsCollapsed={allVisibleGroupsCollapsed}
        onToggleAllGroupsCollapse={showGroupedTableSections && visibleGroups.length > 1 && !isSearching ? toggleAllGroupsCollapse : undefined}
        onOpenBatchGroup={
          canManage && !manageMode && allDevices.length > 0
            ? () =>
                setBatchDialogState({
                  initialGroup: activeGroupSummary && !activeGroupSummary.isUngrouped ? activeGroupSummary.name : null,
                  preselectedIds: selectedIds.size > 0 ? [...selectedIds] : undefined
                })
            : undefined
        }
        actions={
          !manageMode ? (
            <Button variant="secondary" onClick={beginManage} disabled={!canManage || allDevices.length < 2}>
              <Icon name="sort" size={15} />管理顺序
            </Button>
          ) : (
            <div className="workspace-order-actions">
              <Button variant="primary" onClick={() => void saveManage()} disabled={!orderDirty || mutationPending}>
                保存顺序
              </Button>
              <Button variant="quiet" onClick={cancelManage} disabled={mutationPending}>
                取消
              </Button>
            </div>
          )
        }
      />

      {!hasNamedGroups && canManage && !manageMode && allDevices.length >= 2 && !guideDismissed && (
        <Surface className="workspace-group-onboarding" role="region" aria-label="设备分组快速引导">
          <div className="workspace-group-onboarding__copy">
            <strong>按用途建立设备组，直接查看集群容量池与聚合曲线</strong>
            <p>支持点击下方推荐模板快速建组，或直接在表格首列勾选多台设备一键归组。</p>
            <div className="workspace-group-dialog__chips">
              {RECOMMENDED_DEVICE_GROUPS.map((preset) => (
                <M3Chip
                  key={preset}
                  onClick={() =>
                    setBatchDialogState({
                      initialGroup: null,
                      preselectedIds: selectedIds.size > 0 ? [...selectedIds] : undefined
                    })
                  }
                >
                  + {preset}
                </M3Chip>
              ))}
            </div>
          </div>
          <div className="workspace-group-onboarding__actions">
            <Button
              variant="secondary"
              onClick={() =>
                setBatchDialogState({
                  initialGroup: null,
                  preselectedIds: selectedIds.size > 0 ? [...selectedIds] : undefined
                })
              }
            >
              立即创建分组
            </Button>
            <Button
              variant="quiet"
              onClick={() => {
                setGuideDismissed(true);
                try {
                  window.localStorage.setItem(GROUP_GUIDE_DISMISSED_KEY, "true");
                } catch {
                  /* Optional preference. */
                }
              }}
            >
              暂不需要
            </Button>
          </div>
        </Surface>
      )}

      {selectedIds.size > 0 && canManage && (
        <div className="workspace-selection-bar" role="region" aria-label="已选设备批量操作">
          <div className="workspace-selection-bar__summary">
            <M3Badge tone="primary">{`已选 ${selectedIds.size} 台`}</M3Badge>
            <span>
              {selectedDevices
                .slice(0, 3)
                .map((d) => d.hostname)
                .join("、")}
              {selectedDevices.length > 3 ? ` 等 ${selectedDevices.length} 台设备` : ""}
            </span>
          </div>
          <div className="workspace-selection-bar__actions">
            <Button
              variant="primary"
              disabled={mutationPending}
              onClick={() => setGroupTargetIds([...selectedIds])}
            >
              归入分组…
            </Button>
            {anySelectedHasGroup && (
              <Button
                variant="secondary"
                disabled={mutationPending}
                onClick={() => {
                  const ids = [...selectedIds];
                  void updateDeviceGroup(ids, null).then((ok) => {
                    if (ok) setSelectedIds(new Set());
                  });
                }}
              >
                移出分组
              </Button>
            )}
            {visibleDevices.length > selectedIds.size && (
              <Button
                variant="quiet"
                disabled={mutationPending}
                onClick={() => selectDeviceBatch(visibleDevices.map((d) => d.deviceId), true)}
              >
                全选当前 ({visibleDevices.length})
              </Button>
            )}
            <Button variant="quiet" disabled={mutationPending} onClick={() => setSelectedIds(new Set())}>
              取消选择
            </Button>
          </div>
        </div>
      )}

      {manageMode && (
        <div className="workspace-inline-note" role="status">
          <span>上下调整仅生成当前页面草稿，点击“保存顺序”才会写入中枢；当前在可见设备序列内相邻交换。</span>
        </div>
      )}
      {!canManage && (
        <div className="workspace-inline-note" role="status">
          {snapshot.source === "cache" ? "离线缓存为只读快照。" : "需要连接中枢并完成认证后才能删除、分组或调整设备顺序。"}
        </div>
      )}

      {showGroupCardSwimlanes ? (
        <GroupedCardSwimlanes
          groups={visibleGroups}
          thresholds={healthThresholds}
          cpuTrends={cpuTrends}
          groupNetworkRates={groupNetworkRates}
          windowLabel={windowLabel}
          canManage={canManage && !mutationPending}
          onOpenDevice={(deviceId) => navigate({ kind: "device", deviceId })}
          onEditDeviceGroup={canManage ? (device) => setGroupTargetIds([device.deviceId]) : undefined}
          onManageMembers={
            canManage
              ? (group) =>
                  setBatchDialogState({
                    initialGroup: group.isUngrouped ? null : group.name,
                    preselectedIds: group.isUngrouped ? group.devices.map((d) => d.deviceId) : undefined
                  })
              : undefined
          }
          onRenameGroup={canManage ? (group) => setRenamingGroup(group) : undefined}
          onDissolveGroup={canManage ? (group) => setDissolvingGroup(group) : undefined}
          onDropDevices={canDragToGroup ? handleDropDevicesToGroup : undefined}
        />
      ) : showGroupedTableSections ? (
        <div className="workspace-group-sections">
          {visibleGroups.map((group) => {
            const collapsed = isGroupCollapsed(group.key);
            const hideRepeatedHeader = !collapsed && expandedSectionCounter++ > 0;
            return (
              <DeviceGroupSection
                key={group.key}
                group={group}
                thresholds={healthThresholds}
                networkRate={groupNetworkRates.get(group.key)}
                groupCpuTrend={groupCpuTrends.get(group.key)}
                collapsed={collapsed}
                visuallyHideTableHeader={hideRepeatedHeader}
                onToggleCollapse={() => toggleGroupCollapse(group.key)}
                canManage={canManage && !mutationPending}
                enableDragToGroup={canDragToGroup}
                selectedIds={canManage ? selectedIds : undefined}
                onToggleSelect={canManage ? toggleSelectDevice : undefined}
                onSelectBatch={canManage ? selectDeviceBatch : undefined}
                onEditDeviceGroup={canManage ? (device) => setGroupTargetIds([device.deviceId]) : undefined}
                onDeleteDevice={canManage ? setDeleteTarget : undefined}
                onManageMembers={
                  canManage
                    ? () =>
                        setBatchDialogState({
                          initialGroup: group.isUngrouped ? null : group.name,
                          preselectedIds: group.isUngrouped ? group.devices.map((d) => d.deviceId) : undefined
                        })
                    : undefined
                }
                onRenameGroup={!group.isUngrouped && canManage ? () => setRenamingGroup(group) : undefined}
                onDissolveGroup={!group.isUngrouped && canManage ? () => setDissolvingGroup(group) : undefined}
                onDropDevices={canDragToGroup ? (ids) => handleDropDevicesToGroup(ids, group.isUngrouped ? null : group.name) : undefined}
                cpuTrends={cpuTrends}
              />
            );
          })}
        </div>
      ) : (
        <Surface className="workspace-directory-surface guanlan-data-table-surface">
          <div className="workspace-directory-table-scroll">
            <DeviceTable
              devices={visibleDevices}
              order={effectiveOrder}
              manageMode={manageMode && canManage && !mutationPending}
              showGroupBadge={groupFilter === "all"}
              enableDragToGroup={canDragToGroup}
              selectedIds={canManage ? selectedIds : undefined}
              onToggleSelect={canManage ? toggleSelectDevice : undefined}
              onSelectBatch={canManage ? selectDeviceBatch : undefined}
              onMove={moveInstance}
              onDelete={canManage ? setDeleteTarget : undefined}
              onEditGroup={canManage ? (device) => setGroupTargetIds([device.deviceId]) : undefined}
              emptyState={emptyDirectory}
              cpuTrends={cpuTrends}
            />
          </div>
        </Surface>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={`删除“${deleteTarget.hostname}”？`}
          detail="将从中枢移除该采集设备（与设备组无关）。如果该设备上的 Agent 仍在运行，下次上报时会自动重新注册并加回列表。"
          confirmLabel="删除设备"
          disabled={mutationPending}
          onConfirm={() => {
            const deviceId = deleteTarget.deviceId;
            void deleteInstance(deviceId).then((ok) => {
              if (ok) setDeleteTarget(null);
            });
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {groupTargetIds && groupDialogDevices.length > 0 && (
        <DeviceGroupDialog
          title={
            groupDialogDevices.length === 1
              ? `设置“${groupDialogDevices[0].hostname}”的分组`
              : `为 ${groupDialogDevices.length} 台设备设置分组`
          }
          detail={
            groupDialogDevices.length === 1
              ? "选择已有分组或直接输入新分组名称，保存后立即生效；留空即可移出分组。"
              : `已选中 ${groupDialogDevices
                  .map((d) => d.hostname)
                  .slice(0, 4)
                  .join("、")}${groupDialogDevices.length > 4 ? ` 等 ${groupDialogDevices.length} 台设备` : ""}。`
          }
          currentGroup={groupDialogCurrentGroup}
          existingGroups={existingGroupNames}
          disabled={mutationPending}
          onConfirm={(nextGroup) => {
            const targetIds = groupTargetIds;
            void updateDeviceGroup(targetIds, nextGroup).then((ok) => {
              if (!ok) return;
              setGroupTargetIds(null);
              setSelectedIds(new Set());
            });
          }}
          onCancel={() => setGroupTargetIds(null)}
        />
      )}

      {batchDialogState !== null && (
        <BatchGroupManageDialog
          devices={orderedDevices}
          existingGroups={existingGroupNames}
          initialGroup={batchDialogState.initialGroup}
          preselectedIds={batchDialogState.preselectedIds}
          disabled={mutationPending}
          onConfirm={(targetIds, nextGroup) => {
            void updateDeviceGroup(targetIds, nextGroup).then((ok) => {
              if (!ok) return;
              setBatchDialogState(null);
              setSelectedIds(new Set());
            });
          }}
          onSyncMembers={(assignIds, nextGroup, removeIds) => {
            const previousGroup = batchDialogState.initialGroup;
            if (nextGroup && previousGroup && nextGroup !== previousGroup && groupFilter === previousGroup) {
              pendingGroupTransitionRef.current = nextGroup;
            }
            void syncDeviceGroupMembers(assignIds, nextGroup, removeIds).then((ok) => {
              if (!ok) {
                pendingGroupTransitionRef.current = null;
                return;
              }
              setBatchDialogState(null);
              setSelectedIds(new Set());
              if (previousGroup && nextGroup && nextGroup !== previousGroup && groupFilter === previousGroup) {
                changeGroupFilter(nextGroup);
              } else if (previousGroup && assignIds.length === 0 && groupFilter === previousGroup) {
                changeGroupFilter("all");
              }
            });
          }}
          onCancel={() => setBatchDialogState(null)}
        />
      )}

      {renamingGroup && (
        <PromptDialog
          title={`重命名分组“${renamingGroup.name}”`}
          detail={`组内 ${renamingGroup.total} 台设备将一并归入新分组名。`}
          initialValue={renamingGroup.name}
          existingGroups={existingGroupNames}
          confirmLabel="保存名称"
          disabled={mutationPending}
          onConfirm={(canonicalName) => {
            const oldKey = renamingGroup.key;
            if (canonicalName === oldKey) {
              setRenamingGroup(null);
              return;
            }
            const ids = renamingGroup.devices.map((device) => device.deviceId);
            const wasSelected = groupFilter === oldKey;
            if (wasSelected) pendingGroupTransitionRef.current = canonicalName;
            void updateDeviceGroup(ids, canonicalName).then((ok) => {
              if (!ok) {
                pendingGroupTransitionRef.current = null;
                return;
              }
              setCollapsedGroups((current) => {
                if (!current.has(oldKey)) return current;
                const next = new Set(current);
                next.delete(oldKey);
                next.add(canonicalName);
                storeCollapsedGroups(next);
                return next;
              });
              setRenamingGroup(null);
              if (wasSelected) changeGroupFilter(canonicalName);
            });
          }}
          onCancel={() => setRenamingGroup(null)}
        />
      )}

      {dissolvingGroup && (
        <ConfirmDialog
          title={`解散分组“${dissolvingGroup.name}”？`}
          detail={`解散后，组内 ${dissolvingGroup.total} 台设备不会被删除，而是恢复为“未分组”状态。`}
          confirmLabel="解散分组"
          disabled={mutationPending}
          onConfirm={() => {
            const oldKey = dissolvingGroup.key;
            const ids = dissolvingGroup.devices.map((device) => device.deviceId);
            const wasSelected = groupFilter === oldKey;
            void updateDeviceGroup(ids, null).then((ok) => {
              if (!ok) return;
              setCollapsedGroups((current) => {
                if (!current.has(oldKey)) return current;
                const next = new Set(current);
                next.delete(oldKey);
                storeCollapsedGroups(next);
                return next;
              });
              setDissolvingGroup(null);
              if (wasSelected) changeGroupFilter("all");
            });
          }}
          onCancel={() => setDissolvingGroup(null)}
        />
      )}
    </div>
  );
}

function DeviceGroupSection({
  group,
  thresholds,
  networkRate,
  groupCpuTrend,
  collapsed,
  visuallyHideTableHeader = false,
  onToggleCollapse,
  canManage,
  enableDragToGroup,
  selectedIds,
  onToggleSelect,
  onSelectBatch,
  onEditDeviceGroup,
  onDeleteDevice,
  onManageMembers,
  onRenameGroup,
  onDissolveGroup,
  onDropDevices,
  cpuTrends
}: {
  group: DeviceGroupSummary;
  thresholds: HealthThresholds;
  networkRate?: GroupNetworkRateSummary;
  groupCpuTrend?: readonly SamplePoint[];
  collapsed: boolean;
  visuallyHideTableHeader?: boolean;
  onToggleCollapse: () => void;
  canManage: boolean;
  enableDragToGroup?: boolean;
  selectedIds?: ReadonlySet<string>;
  onToggleSelect?: (deviceId: string, checked: boolean) => void;
  onSelectBatch?: (deviceIds: string[], checked: boolean) => void;
  onEditDeviceGroup?: (device: DeviceSummary) => void;
  onDeleteDevice?: (device: DeviceSummary) => void;
  onManageMembers?: () => void;
  onRenameGroup?: () => void;
  onDissolveGroup?: () => void;
  onDropDevices?: (deviceIds: string[]) => void;
  cpuTrends?: ReadonlyMap<string, readonly SamplePoint[]>;
}) {
  const { onPointerDown, rippleNodes } = useRipple<HTMLButtonElement>();
  const [isDropOver, setIsDropOver] = useState(false);

  const online = group.online > 0;
  const memPct = group.pooledMemoryPercent ?? group.avgMemoryPercent;
  const diskPct = group.pooledDiskPercent ?? group.avgDiskPercent;
  const cpuTone = online ? metricTone(group.avgCpuPercent, thresholds.cpu) : "normal";
  const memTone = online ? metricTone(memPct, thresholds.memory) : "normal";
  const diskTone = online ? metricTone(diskPct, thresholds.disk) : "normal";

  const onlineBadgeTone =
    group.online === 0
      ? "neutral"
      : group.criticalCount > 0
        ? "error"
        : group.warningCount > 0 || group.offline > 0
          ? "warning"
          : "success";

  return (
    <Surface
      className={`workspace-group-section guanlan-data-table-surface${collapsed ? " is-collapsed" : ""}${isDropOver ? " is-drop-target" : ""}`}
      onDragOver={
        onDropDevices
          ? (event: React.DragEvent<HTMLElement>) => {
              if (!isDeviceGroupDragEvent(event)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              if (!isDropOver) setIsDropOver(true);
            }
          : undefined
      }
      onDragLeave={
        onDropDevices
          ? (event: React.DragEvent<HTMLElement>) => {
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
              if (isDropOver) setIsDropOver(false);
            }
          : undefined
      }
      onDrop={
        onDropDevices
          ? (event: React.DragEvent<HTMLElement>) => {
              if (!isDeviceGroupDragEvent(event)) return;
              event.preventDefault();
              setIsDropOver(false);
              const ids = readDroppedDeviceIds(event);
              if (ids.length > 0) onDropDevices(ids);
            }
          : undefined
      }
    >
      <div className="workspace-group-section__header">
        <button
          type="button"
          className="workspace-group-section__toggle m3e-state-host"
          onPointerDown={onPointerDown}
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "展开" : "收起"}分组 ${group.name}`}
        >
          <span className="workspace-group-section__chevron" aria-hidden="true">
            <Icon name="chevron" size={18} />
          </span>
          <StatusDot state={group.state} />
          <strong className="workspace-group-section__title" title={group.name}>
            {group.name}
          </strong>
          <M3Badge tone={onlineBadgeTone}>{`${group.online}/${group.total} 在线`}</M3Badge>
          {group.overThreshold > 0 && (
            <M3Badge tone={group.criticalCount > 0 ? "error" : "warning"}>{`${group.overThreshold} 台超限`}</M3Badge>
          )}
          <GroupHealthBar group={group} className="workspace-group-section__health-bar" />
          {rippleNodes}
        </button>

        <div className="workspace-group-section__telemetry" aria-label={`${group.name} 资源池摘要`}>
          <div className="workspace-group-section__stat" title={group.maxCpu ? `最高负载：${group.maxCpu.hostname} ${formatPercent(group.maxCpu.percent)}` : undefined}>
            <div className="workspace-group-section__stat-top">
              <span>CPU</span>
              <strong>{formatPercent(group.avgCpuPercent)}</strong>
              {group.total > 1 && group.maxCpu && group.maxCpu.severity !== "normal" && (
                <small className={`is-${group.maxCpu.severity}`}>峰 {formatPercent(group.maxCpu.percent)}</small>
              )}
            </div>
            <CapacityBar percent={group.avgCpuPercent} tone={cpuTone} marks={thresholds.cpu} size="sm" />
          </div>

          <div
            className="workspace-group-section__stat"
            title={`组内存池：${formatGroupPoolCaption(group.memoryUsedBytes, group.memoryTotalBytes)}`}
          >
            <div className="workspace-group-section__stat-top">
              <span>内存池</span>
              <strong>{formatPercent(memPct)}</strong>
              {group.memoryTotalBytes ? <small>{formatGroupPoolCaption(group.memoryUsedBytes, group.memoryTotalBytes)}</small> : null}
            </div>
            <CapacityBar percent={memPct} tone={memTone} marks={thresholds.memory} size="sm" />
          </div>

          <div
            className="workspace-group-section__stat"
            title={`组存储池：${formatGroupPoolCaption(group.diskUsedBytes, group.diskTotalBytes)}`}
          >
            <div className="workspace-group-section__stat-top">
              <span>存储池</span>
              <strong>{formatPercent(diskPct)}</strong>
              {group.diskTotalBytes ? <small>{formatGroupPoolCaption(group.diskUsedBytes, group.diskTotalBytes)}</small> : null}
            </div>
            <CapacityBar percent={diskPct} tone={diskTone} marks={thresholds.disk} size="sm" />
          </div>

          {networkRate && networkRate.reportingCount > 0 && (
            <div className="workspace-group-section__net" title="组内在线设备实时总带宽">
              <span>总网速</span>
              <strong>↓ {formatRate(networkRate.rxBytesPerSec)}</strong>
              <small>↑ {formatRate(networkRate.txBytesPerSec)}</small>
            </div>
          )}

          {groupCpuTrend && groupCpuTrend.length > 1 && (
            <Sparkline
              points={groupCpuTrend}
              maxValue={100}
              tone={cpuTone}
              height={24}
              className="workspace-group-section__spark"
            />
          )}
        </div>

        {canManage && (
          <div className="workspace-group-section__actions">
            {onManageMembers && (
              <button type="button" className="workspace-group-section__action" onClick={onManageMembers}>
                {group.isUngrouped ? "批量归组" : "管理成员"}
              </button>
            )}
            {!group.isUngrouped && onRenameGroup && (
              <button type="button" className="workspace-group-section__action" onClick={onRenameGroup}>
                重命名
              </button>
            )}
            {!group.isUngrouped && onDissolveGroup && (
              <button type="button" className="workspace-group-section__action is-danger" onClick={onDissolveGroup}>
                解散
              </button>
            )}
          </div>
        )}
      </div>

      <div className={`workspace-group-section__collapse${collapsed ? " is-collapsed" : ""}`} aria-hidden={collapsed}>
        <div className="workspace-group-section__body">
          <div className="workspace-directory-table-scroll">
            <DeviceTable
              devices={group.devices}
              showGroupBadge={false}
              visuallyHideHeader={visuallyHideTableHeader}
              enableDragToGroup={enableDragToGroup}
              selectedIds={selectedIds}
              onToggleSelect={onToggleSelect}
              onSelectBatch={onSelectBatch}
              onEditGroup={onEditDeviceGroup}
              onDelete={onDeleteDevice}
              cpuTrends={cpuTrends}
            />
          </div>
        </div>
      </div>
    </Surface>
  );
}
