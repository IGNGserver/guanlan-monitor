import React, { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../WorkspaceContext";
import { useTouchState } from "./TouchState";
import {
  selectAttentionDevices,
  selectDeviceDirectory,
  selectDeviceGroups,
  selectHealthSummary,
  type DeviceGroupFilter
} from "../selectors";
import { Button, Icon } from "../ui";
import { M3Badge, M3Chip, M3SegmentedControl, M3Select } from "../m3";
import { CapacityBar, TimeSeriesChart, type ChartSeries } from "../charts";
import { metricTone, thresholdLines } from "../health";
import { selectFleetTrends, selectGroupFleetTrends, type FleetMetric } from "../fleetTrends";
import { formatDate, formatPercent, formatRate } from "../formatters";
import { EmptyState, metricWindowOptions, type DesktopMetricWindowValue } from "../pages/shared";
import { GroupHealthBar, formatGroupPoolCaption } from "../pages/GroupVisuals";
import { TouchDeviceRow } from "./TouchDeviceRow";

const TREND_TITLES: Record<FleetMetric, string> = {
  cpu: "CPU 使用率",
  memory: "内存占用率",
  disk: "磁盘占用率",
  network: "网络收发"
};

function TouchFleetTrend() {
  const { snapshot, allDevices, metricsWindow, setMetricsWindow, healthThresholds, route, navigate } = useWorkspace();
  const routeGroup = route.kind === "overview" && route.group ? route.group : "all";
  const [metric, setMetric] = useState<FleetMetric>("cpu");
  const [userGranularity, setUserGranularity] = useState<"group" | "device" | null>(null);
  const groupFilter: DeviceGroupFilter = routeGroup;
  const changeGroupFilter = (nextGroup: DeviceGroupFilter) => {
    if (route.kind === "overview") {
      navigate(nextGroup === "all" ? { kind: "overview" } : { kind: "overview", group: nextGroup });
    }
  };
  const groups = useMemo(() => selectDeviceGroups(allDevices, healthThresholds), [allDevices, healthThresholds]);
  const hasNamedGroups = useMemo(() => groups.some((group) => !group.isUngrouped), [groups]);
  const activeGroup = groupFilter !== "all" && !groups.some((group) => group.key === groupFilter) ? "all" : groupFilter;
  const scopedDevices = useMemo(() => selectDeviceDirectory(allDevices, { group: activeGroup }), [allDevices, activeGroup]);
  const scopedDeviceIds = useMemo(() => new Set(scopedDevices.map((d) => d.deviceId)), [scopedDevices]);
  const instances = snapshot?.overviewMetrics?.instances;
  const scopedInstances = useMemo(
    () => (instances ?? []).filter((instance) => scopedDeviceIds.has(instance.deviceId)),
    [instances, scopedDeviceIds]
  );

  const canAggregateByGroup = activeGroup === "all" && hasNamedGroups;
  const effectiveGranularity = canAggregateByGroup
    ? userGranularity ?? (allDevices.length > 6 ? "group" : "device")
    : "device";

  const fleet = useMemo(() => selectFleetTrends(scopedInstances, scopedDevices, metric), [scopedInstances, scopedDevices, metric]);
  const groupFleet = useMemo(() => selectGroupFleetTrends(instances ?? [], groups, metric), [groups, instances, metric]);

  const series = useMemo<ChartSeries[]>(() => {
    if (effectiveGranularity === "group") {
      return groupFleet.trends.map((trend) => ({
        id: trend.groupKey,
        label: trend.offline ? `${trend.groupName}（离线）` : `${trend.groupName} (${trend.onlineCount}/${trend.deviceCount})`,
        points: trend.points,
        valueFormatter: groupFleet.percent ? formatPercent : formatRate,
        dashed: trend.offline
      }));
    }
    return fleet.trends.map((trend) => ({
      id: trend.deviceId,
      label: trend.offline ? `${trend.hostname}（离线）` : trend.hostname,
      points: trend.points,
      valueFormatter: fleet.percent ? formatPercent : formatRate,
      dashed: trend.offline
    }));
  }, [effectiveGranularity, fleet, groupFleet]);

  if (!instances?.length) return null;
  const isPercent = effectiveGranularity === "group" ? groupFleet.percent : fleet.percent;
  const missing = effectiveGranularity === "group" ? groupFleet.missingCapacityGroups : fleet.missingCapacity;

  return (
    <section className="touch-trend" aria-labelledby="touch-trend-title">
      <header>
        <h2 id="touch-trend-title">{TREND_TITLES[metric]}</h2>
        <M3Select
          label="时间范围"
          hideLabel
          value={metricsWindow}
          onChange={(event) => setMetricsWindow(event.target.value as DesktopMetricWindowValue)}
          options={metricWindowOptions}
        />
      </header>
      {hasNamedGroups && (
        <div className="touch-group-chips" role="group" aria-label="趋势分组范围">
          <M3Chip selected={activeGroup === "all"} onClick={() => changeGroupFilter("all")}>
            全部 ({allDevices.length})
          </M3Chip>
          {groups.map((item) => (
            <M3Chip key={item.key} selected={activeGroup === item.key} onClick={() => changeGroupFilter(item.key)}>
              {item.name} ({item.online}/{item.total})
            </M3Chip>
          ))}
        </div>
      )}
      <div className="touch-trend__controls">
        <M3SegmentedControl
          size="sm"
          aria-label="趋势指标"
          value={metric}
          onChange={(value) => setMetric(value as FleetMetric)}
          options={[
            { value: "cpu", label: "CPU" },
            { value: "memory", label: "内存" },
            { value: "disk", label: "磁盘" },
            { value: "network", label: "网络" }
          ]}
        />
        {canAggregateByGroup && (
          <M3SegmentedControl
            size="sm"
            aria-label="趋势聚合方式"
            value={effectiveGranularity}
            onChange={(value) => setUserGranularity(value as "group" | "device")}
            options={[
              { value: "group", label: "按组" },
              { value: "device", label: "单机" }
            ]}
          />
        )}
      </div>
      <TimeSeriesChart
        series={series}
        maxValue={isPercent ? 100 : undefined}
        compact
        height={200}
        inspectionToleranceMs={2500}
        thresholds={metric === "network" ? undefined : thresholdLines(healthThresholds[metric])}
      />
      {missing.length ? <p className="touch-section__hint">{missing.join("、")} 未上报容量，未绘制</p> : null}
    </section>
  );
}

export function TouchOverview() {
  const { route, snapshot, allDevices, navigate, openSettings, capabilities, healthThresholds } = useWorkspace();
  const { pins, setStatus, setQuery, setGroup } = useTouchState();
  const groups = useMemo(() => selectDeviceGroups(allDevices, healthThresholds), [allDevices, healthThresholds]);
  const hasNamedGroups = useMemo(() => groups.some((group) => !group.isUngrouped), [groups]);
  const routeGroup = route.kind === "overview" && route.group ? route.group : "all";
  const activeGroup = routeGroup !== "all" && !groups.some((item) => item.key === routeGroup) ? "all" : routeGroup;

  useEffect(() => {
    if (routeGroup !== "all" && allDevices.length > 0 && !groups.some((item) => item.key === routeGroup)) {
      navigate({ kind: "overview" });
    }
  }, [allDevices.length, groups, navigate, routeGroup]);

  const scopedDevices = useMemo(
    () => selectDeviceDirectory(allDevices, { group: activeGroup }),
    [activeGroup, allDevices]
  );
  const activeGroupSummary = useMemo(
    () => (activeGroup === "all" ? null : groups.find((item) => item.key === activeGroup) ?? null),
    [activeGroup, groups]
  );

  if (!snapshot) return null;
  const health = selectHealthSummary(
    snapshot,
    scopedDevices,
    formatDate,
    capabilities.liveDataTransport,
    healthThresholds,
    { scoped: activeGroup !== "all" }
  );
  const attention = health.source === "live" ? selectAttentionDevices(scopedDevices, 3, healthThresholds) : [];
  const onlyOffline = health.overThreshold === 0;
  const pinned = scopedDevices.filter((device) => pins.includes(device.deviceId));
  const frequent = pinned.length ? pinned : scopedDevices.slice(0, 4);

  const openAttention = () => {
    setStatus(onlyOffline ? "offline" : "all");
    setQuery("");
    setGroup(activeGroup);
    navigate(activeGroup === "all" ? { kind: "devices" } : { kind: "devices", group: activeGroup });
  };
  const openGroup = (groupKey: string) => {
    setGroup(groupKey);
    setStatus("all");
    setQuery("");
    navigate({ kind: "devices", group: groupKey });
  };

  return (
    <div className="touch-page touch-overview">
      <header className="touch-page-title">
        <p>{activeGroupSummary ? `设备组 · ${activeGroupSummary.name}` : "设备状态"}</p>
        <h1>总览</h1>
      </header>
      <section className={`touch-health${health.pending ? " has-attention" : ""}`} aria-label="中枢概况">
        <span className="touch-health__mark">
          <Icon name={health.source === "cache" ? "clock" : health.pending ? "warning" : "check"} size={28} />
        </span>
        <p>
          {health.source === "cache"
            ? "当前状态待确认"
            : health.source === "unknown"
              ? "等待恢复连接"
              : !allDevices.length
                ? "等待第一台设备"
                : health.pending
                  ? `${health.pending} 台设备需要关注`
                  : activeGroupSummary
                    ? `“${activeGroupSummary.name}”设备都在线`
                    : "设备都在线"}
        </p>
        <span>
          {health.source === "cache"
            ? "显示上次保存的数据，联网后重新确认"
            : health.source === "unknown"
              ? "暂时无法确认设备状态"
              : `${health.online} 台在线 · ${health.total} 台${activeGroupSummary ? "本组设备" : "已接入"}`}
        </span>
        <div className="touch-health__counts">
          <div>
            <strong>{health.source === "cache" || health.source === "unknown" ? "—" : health.online}</strong>
            <span>在线</span>
          </div>
          <div>
            <strong>{health.pending ?? "—"}</strong>
            <span>需关注</span>
          </div>
          <div>
            <strong>{health.total}</strong>
            <span>{health.source === "cache" ? "已缓存" : "设备"}</span>
          </div>
        </div>
        <small>{health.sourceDetail}</small>
      </section>

      <TouchFleetTrend />

      {!!attention.length && (
        <section className="touch-section">
          <header>
            <h2>需要关注</h2>
            <Button variant="text" onClick={openAttention}>
              查看全部<Icon name="chevronRight" size={16} />
            </Button>
          </header>
          <p className="touch-section__hint">
            {onlyOffline
              ? "离线设备保留最近一次上报，请查看最后在线时间。"
              : "离线设备和资源超过阈值的设备，最紧急的在前。"}
          </p>
          <div className="touch-device-list">
            {attention.map((device) => (
              <TouchDeviceRow key={device.deviceId} device={device} />
            ))}
          </div>
        </section>
      )}

      {hasNamedGroups && (
        <section className="touch-section" aria-label="设备组速览">
          <header>
            <h2>设备组容量速览</h2>
            <Button
              variant="text"
              onClick={() => {
                setGroup("all");
                setStatus("all");
                setQuery("");
                navigate({ kind: "devices" });
              }}
            >
              管理分组<Icon name="chevronRight" size={16} />
            </Button>
          </header>
          <div className="touch-overview-groups">
            {groups.map((item) => {
              const online = item.online > 0;
              const memPct = item.pooledMemoryPercent ?? item.avgMemoryPercent;
              const cpuTone = online ? metricTone(item.avgCpuPercent, healthThresholds.cpu) : "normal";
              const memTone = online ? metricTone(memPct, healthThresholds.memory) : "normal";
              return (
                <button
                  key={item.key}
                  type="button"
                  className={`touch-overview-group-card is-${item.state}`}
                  onClick={() => openGroup(item.key)}
                >
                  <span className="touch-overview-group-card__head">
                    <span className="workspace-group-chip-content">
                      <span className={`workspace-group-chip-dot is-${item.state}`} aria-hidden="true" />
                      <strong>{item.name}</strong>
                    </span>
                    <small>{item.online}/{item.total} 在线</small>
                  </span>
                  <GroupHealthBar group={item} />
                  <span className="touch-overview-group-card__bars">
                    <span className="touch-overview-group-card__bar-row">
                      <span>CPU</span>
                      <CapacityBar percent={item.avgCpuPercent} tone={cpuTone} marks={healthThresholds.cpu} size="sm" />
                      <strong>{formatPercent(item.avgCpuPercent)}</strong>
                    </span>
                    <span className="touch-overview-group-card__bar-row">
                      <span>内存池</span>
                      <CapacityBar percent={memPct} tone={memTone} marks={healthThresholds.memory} size="sm" />
                      <strong>{formatPercent(memPct)}</strong>
                    </span>
                  </span>
                  <span className="touch-overview-group-card__meta">
                    {item.overThreshold > 0 ? (
                      <M3Badge tone={item.criticalCount > 0 ? "error" : "warning"}>{`${item.overThreshold} 台超限`}</M3Badge>
                    ) : null}
                    {item.offline > 0 ? <M3Badge tone="neutral">{`${item.offline} 离线`}</M3Badge> : null}
                    <span>{formatGroupPoolCaption(item.memoryUsedBytes, item.memoryTotalBytes, "点击查看组内设备")}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {!!frequent.length && (
        <section className="touch-section">
          <header>
            <h2>{pinned.length ? "常用设备" : "设备速览"}</h2>
            <Button
              variant="text"
              onClick={() => {
                setStatus("all");
                setQuery("");
                navigate({ kind: "devices" });
              }}
            >
              全部设备<Icon name="chevronRight" size={16} />
            </Button>
          </header>
          {!pinned.length && <p className="touch-section__hint">在设备的更多操作中设为常用，下次打开即可查看。</p>}
          <div className="touch-device-list">
            {frequent.map((device) => (
              <TouchDeviceRow key={device.deviceId} device={device} />
            ))}
          </div>
        </section>
      )}

      {!allDevices.length && (
        <EmptyState
          title="让设备开始上报"
          detail="在设备上运行 Agent 并连接当前中枢，首次上报后会自动出现在这里。"
          action={
            <Button variant="primary" onClick={() => openSettings("connections")}>
              查看连接
            </Button>
          }
        />
      )}
    </div>
  );
}
