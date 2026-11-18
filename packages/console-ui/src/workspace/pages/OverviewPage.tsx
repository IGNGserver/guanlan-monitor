import React, { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../WorkspaceContext";
import { Button, Icon, StatusLabel, Surface, SummaryRow } from "../ui";
import { M3Banner, M3Chip, M3SegmentedControl } from "../m3";
import { TimeSeriesChart, type ChartSeries } from "../charts";
import { ChartTile } from "../dashboard";
import { OnboardingGuide } from "../shell/OnboardingGuide";
import { DeviceChartSheet } from "./DeviceChartSheet";
import { formatDate, formatRate, formatPercent } from "../formatters";
import {
  selectDeviceDirectory,
  selectDeviceGroups,
  selectHealthSummary,
  type DeviceGroupFilter
} from "../selectors";
import { thresholdLines } from "../health";
import {
  selectFleetTrends,
  selectGroupFleetTrends,
  selectGroupNetworkRates,
  type FleetMetric
} from "../fleetTrends";
import { RenderBoundary } from "../RenderBoundary";
import { DeviceIssueList } from "./DeviceIssueList";
import { FleetGrid } from "./FleetGrid";
import {
  GroupOverviewGrid,
  GroupScopeTelemetryStrip,
  formatGroupPoolCaption
} from "./GroupVisuals";
import {
  ErrorSurface,
  LoadingSurface,
  MetricWindowControl,
  PageIntro,
  OverviewSummary,
  SnapshotFreshnessNotice,
  type DesktopMetricWindowValue
} from "./shared";

const observationLabels: Record<FleetMetric, string> = {
  cpu: "CPU 使用率",
  memory: "内存占用率",
  disk: "磁盘占用率",
  network: "网络收发"
};

const WINDOW_LABELS: Record<string, string> = {
  "1m": "1 分钟",
  "5m": "5 分钟",
  "15m": "15 分钟",
  "1h": "1 小时",
  "6h": "6 小时",
  "24h": "1 天",
  "1d": "1 天",
  "7d": "1 周",
  "1w": "1 周",
  "30d": "1 个月",
  "1mo": "1 个月",
  "90d": "90 天",
  "1y": "1 年"
};

type TrendGranularity = "group" | "device";

function failureGuide(isDesktopShell: boolean): string {
  return isDesktopShell
    ? "桌面桥接尚未准备好。请重新打开观澜后再试。"
    : "网页端通过当前站点读取中枢。请刷新页面重试；如果仍然读不到，请到“设置 · 连接”用访问密钥重新完成认证，并确认站点配置的中枢地址正在运行。";
}

export function OverviewPage() {
  const {
    route,
    snapshot,
    allDevices,
    metricsWindow,
    setMetricsWindow,
    loading,
    refreshing,
    error,
    refresh,
    openSettings,
    navigate,
    capabilities,
    healthThresholds
  } = useWorkspace();

  const [observationMetric, setObservationMetric] = useState<FleetMetric>("cpu");
  const [userTrendGranularity, setUserTrendGranularity] = useState<TrendGranularity | null>(null);
  const routeGroup = route.kind === "overview" && route.group ? route.group : "all";
  const [groupFilter, setGroupFilter] = useState<DeviceGroupFilter>(routeGroup);

  useEffect(() => {
    setGroupFilter(routeGroup);
  }, [routeGroup]);

  const groups = useMemo(() => selectDeviceGroups(allDevices, healthThresholds), [allDevices, healthThresholds]);
  const hasNamedGroups = useMemo(() => groups.some((group) => !group.isUngrouped), [groups]);
  const activeGroupFilter = groupFilter !== "all" && !groups.some((group) => group.key === groupFilter) ? "all" : groupFilter;

  // Clean up dead group hash when a group is dissolved or renamed elsewhere.
  useEffect(() => {
    if (groupFilter !== "all" && allDevices.length > 0 && !groups.some((group) => group.key === groupFilter)) {
      setGroupFilter("all");
      if (route.kind === "overview" && route.group) {
        navigate({ kind: "overview" });
      }
    }
  }, [allDevices.length, groupFilter, groups, navigate, route]);

  const changeGroupFilter = (nextGroup: DeviceGroupFilter) => {
    setGroupFilter(nextGroup);
    if (route.kind === "overview") {
      const normalized = nextGroup === "all" ? undefined : nextGroup;
      if (route.group !== normalized) {
        navigate(normalized ? { kind: "overview", group: normalized } : { kind: "overview" });
      }
    }
  };

  const activeGroupSummary = useMemo(
    () => (activeGroupFilter === "all" ? null : groups.find((group) => group.key === activeGroupFilter) ?? null),
    [activeGroupFilter, groups]
  );
  const scopedDevices = useMemo(
    () => selectDeviceDirectory(allDevices, { group: activeGroupFilter }),
    [allDevices, activeGroupFilter]
  );
  const scopedDeviceIds = useMemo(() => new Set(scopedDevices.map((d) => d.deviceId)), [scopedDevices]);
  const activeGroupName = useMemo(() => {
    if (activeGroupFilter === "all") return "全部设备";
    return groups.find((group) => group.key === activeGroupFilter)?.name ?? "全部设备";
  }, [activeGroupFilter, groups]);
  const deviceGroupsById = useMemo(
    () => new Map(allDevices.map((d) => [d.deviceId, d.group?.trim() || null])),
    [allDevices]
  );

  // Global health is retained for HubStatusCard, while scopedHealth drives KPIs & issues when viewing a group!
  const globalHealth = useMemo(
    () =>
      snapshot
        ? selectHealthSummary(snapshot, allDevices, formatDate, capabilities.liveDataTransport, healthThresholds)
        : null,
    [snapshot, allDevices, capabilities.liveDataTransport, healthThresholds]
  );
  const health = useMemo(
    () =>
      snapshot
        ? activeGroupFilter === "all"
          ? globalHealth
          : selectHealthSummary(snapshot, scopedDevices, formatDate, capabilities.liveDataTransport, healthThresholds, {
              scoped: true
            })
        : null,
    [activeGroupFilter, capabilities.liveDataTransport, globalHealth, healthThresholds, scopedDevices, snapshot]
  );

  const overviewInstances = snapshot?.overviewMetrics?.instances;
  const scopedOverviewInstances = useMemo(
    () => (overviewInstances ?? []).filter((instance) => scopedDeviceIds.has(instance.deviceId)),
    [overviewInstances, scopedDeviceIds]
  );

  const canAggregateByGroup = activeGroupFilter === "all" && hasNamedGroups;
  const defaultGranularity: TrendGranularity = canAggregateByGroup && allDevices.length > 6 ? "group" : "device";
  const effectiveGranularity: TrendGranularity = canAggregateByGroup
    ? userTrendGranularity ?? defaultGranularity
    : "device";

  const fleet = useMemo(
    () => selectFleetTrends(scopedOverviewInstances, scopedDevices, observationMetric),
    [scopedOverviewInstances, scopedDevices, observationMetric]
  );
  const groupFleet = useMemo(
    () => selectGroupFleetTrends(overviewInstances ?? [], groups, observationMetric),
    [groups, observationMetric, overviewInstances]
  );
  const groupNetworkRates = useMemo(
    () => selectGroupNetworkRates(overviewInstances, groups),
    [groups, overviewInstances]
  );

  const observationSeries = useMemo<ChartSeries[]>(() => {
    if (effectiveGranularity === "group") {
      return groupFleet.trends.map((trend) => ({
        id: trend.groupKey,
        label: trend.offline
          ? `${trend.groupName}（全组离线）`
          : `${trend.groupName} (${trend.onlineCount}/${trend.deviceCount})`,
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

  const trendsByDevice = useMemo(() => new Map(fleet.trends.map((trend) => [trend.deviceId, trend.points])), [fleet]);
  const trendsByGroup = useMemo(
    () => new Map(groupFleet.trends.map((trend) => [trend.groupKey, trend.points])),
    [groupFleet]
  );

  if (loading && !snapshot) return <LoadingSurface />;
  if (!snapshot || !health || !globalHealth) {
    return (
      <ErrorSurface
        title="无法读取设备状态"
        detail={error ?? failureGuide(capabilities.canControlNativeWindow)}
        onRetry={() => void refresh()}
      />
    );
  }

  const cached = health.source === "cache";
  const noData = globalHealth.total === 0;
  const hubAbnormal = health.source === "cache" || health.source === "unknown";
  const localIssues = activeGroupFilter === "all" ? (snapshot.localBackend?.lastIssueCount ?? 0) : 0;
  const metricWindowLabel = WINDOW_LABELS[metricsWindow] ?? metricsWindow;
  const attentionCount = health.pending;
  const attentionDetail =
    health.source === "empty"
      ? "还没有设备接入"
      : attentionCount == null
        ? "连接状态异常，暂无法判断"
        : attentionCount === 0
          ? activeGroupSummary
            ? `“${activeGroupSummary.name}”内没有需要处理的项目`
            : "当前没有需要关注的项目"
          : [
              health.offline ? `${health.offline} 台设备离线` : "",
              health.overThreshold ? `${health.overThreshold} 台资源超过阈值` : "",
              localIssues ? `${localIssues} 条本机采集问题` : ""
            ]
              .filter(Boolean)
              .join(" · ");
  const tone = hubAbnormal ? "warning" : noData ? "empty" : attentionCount ? "warning" : "normal";

  const isPercentAxis = effectiveGranularity === "group" ? groupFleet.percent : fleet.percent;
  const missingList = effectiveGranularity === "group" ? groupFleet.missingCapacityGroups : fleet.missingCapacity;
  const observationHasData = observationSeries.some((series) => series.points.length > 0);
  const observationEmptyMessage = (overviewInstances?.length ?? 0)
    ? observationHasData
      ? undefined
      : observationLabels[observationMetric] + "暂无可用数据（缺失指标不会被估算）"
    : "当前还没有任何设备的总览样本";
  const observationNote = [
    effectiveGranularity === "group"
      ? observationMetric === "cpu"
        ? "每组一条线：组内在线设备均值（点击图例右侧箭头可下钻单组）"
        : observationMetric === "network"
          ? "每组一条线：组内全部在线设备上下行总带宽"
          : "每组一条线：按整组真实已用字节 / 总容量加权计算"
      : isPercentAxis && observationMetric !== "cpu"
        ? "按每台设备自身容量的占比绘制"
        : observationMetric === "network"
          ? "每台设备一条线：接收与发送之和"
          : "",
    missingList.length ? `${missingList.join("、")} 未上报容量，未绘制` : "",
    observationSeries.some((series) => series.dashed) ? "虚线表示离线历史" : ""
  ]
    .filter(Boolean)
    .join(" · ");
  const thresholdMetric = observationMetric === "network" ? null : observationMetric;

  const scopePoolHint = activeGroupSummary
    ? [
        activeGroupSummary.memoryTotalBytes
          ? `内存池 ${formatGroupPoolCaption(activeGroupSummary.memoryUsedBytes, activeGroupSummary.memoryTotalBytes)}`
          : "",
        activeGroupSummary.diskTotalBytes
          ? `存储池 ${formatGroupPoolCaption(activeGroupSummary.diskUsedBytes, activeGroupSummary.diskTotalBytes)}`
          : ""
      ]
        .filter(Boolean)
        .join(" · ") || `${activeGroupSummary.name} 分组范围`
    : undefined;

  return (
    <div className="workspace-page workspace-page--overview">
      <PageIntro
        tone={tone}
        eyebrow={activeGroupSummary ? `总览 · ${activeGroupSummary.name}` : "总览"}
        title={
          hubAbnormal
            ? "中枢连接异常"
            : noData
              ? "等待设备接入"
              : attentionCount
                ? `${attentionCount} 项需要关注`
                : activeGroupSummary
                  ? `${activeGroupSummary.name} 状态正常`
                  : "系统状态正常"
        }
        description={
          health.source === "empty"
            ? "还没有收到任何设备的实时状态。Agent 上报一次后，设备会自动出现在这里。"
            : hubAbnormal
              ? cached
                ? "当前显示的是离线缓存，" + health.sourceDetail + "；无法确认中枢现在的状态。"
                : "无法连接到中枢。请检查中枢地址与访问密钥。"
              : `${health.sourceDetail}。${activeGroupSummary ? `当前聚焦分组“${activeGroupSummary.name}”（共 ${allDevices.length} 台设备已接入）。` : "统计覆盖全部已接入设备。"}`
        }
        actions={
          <div className="workspace-order-actions">
            {activeGroupSummary && (
              <Button variant="quiet" onClick={() => changeGroupFilter("all")}>
                查看全站总览
              </Button>
            )}
            <Button
              variant="quiet"
              onClick={() =>
                navigate(activeGroupFilter === "all" ? { kind: "devices" } : { kind: "devices", group: activeGroupFilter })
              }
            >
              {activeGroupFilter === "all" ? "全部设备目录" : `${activeGroupName} · 设备目录`}
              <Icon name="arrow" size={16} />
            </Button>
          </div>
        }
      />

      {!hubAbnormal && <SnapshotFreshnessNotice />}

      {hasNamedGroups && (
        <div className="workspace-group-filter-bar" role="group" aria-label="总览分组范围">
          <span className="workspace-group-filter-bar__label">
            <Icon name="filter" size={14} />分组视图
          </span>
          <div className="workspace-group-filter-bar__chips">
            <M3Chip selected={activeGroupFilter === "all"} onClick={() => changeGroupFilter("all")}>
              全部设备 ({allDevices.length})
            </M3Chip>
            {groups.map((group) => (
              <M3Chip
                key={group.key}
                selected={activeGroupFilter === group.key}
                onClick={() => changeGroupFilter(group.key)}
              >
                <span className="workspace-group-chip-content">
                  <span className={`workspace-group-chip-dot is-${group.state}`} aria-hidden="true" />
                  <span>{group.name}</span>
                  <small>{group.online}/{group.total}</small>
                </span>
              </M3Chip>
            ))}
          </div>
          <div className="workspace-group-filter-bar__actions">
            {activeGroupSummary ? (
              <Button variant="quiet" onClick={() => navigate({ kind: "devices", group: activeGroupSummary.key })}>
                管理“{activeGroupSummary.name}”<Icon name="arrow" size={14} />
              </Button>
            ) : (
              <Button variant="quiet" onClick={() => navigate({ kind: "devices" })}>
                分组管理<Icon name="arrow" size={14} />
              </Button>
            )}
          </div>
        </div>
      )}

      <OverviewSummary
        total={health.total}
        online={health.online}
        offline={health.offline}
        attentionCount={attentionCount}
        attentionDetail={attentionDetail}
        sourceLabel={health.sourceLabel}
        sourceState={
          health.source === "live"
            ? "online"
            : health.source === "cache"
              ? "cached"
              : health.source === "unknown"
                ? "warning"
                : "unknown"
        }
        sourceDetail={health.sourceDetail}
        scopeTitle={activeGroupSummary ? "本组设备" : undefined}
        scopeHint={scopePoolHint}
      />

      {activeGroupSummary && (
        <GroupScopeTelemetryStrip
          group={activeGroupSummary}
          thresholds={healthThresholds}
          networkRate={groupNetworkRates.get(activeGroupSummary.key)}
          cpuSparkline={trendsByGroup.get(activeGroupSummary.key)}
        />
      )}

      {hubAbnormal ? (
        <M3Banner
          tone="warning"
          className="workspace-attention"
          title="中枢连接异常"
          action={<Button variant="quiet" onClick={() => openSettings("connections")}>连接设置</Button>}
        >
          {cached ? "无法取得最新数据，页面中的设备信息可能已经过期。" : "无法连接到中枢，请检查中枢地址与访问密钥后重试。"}
        </M3Banner>
      ) : health.source === "empty" ? (
        <M3Banner
          tone="info"
          className="workspace-attention"
          title="还没有可用设备"
          action={<Button variant="quiet" onClick={() => openSettings("connections")}>配置数据来源</Button>}
        >
          连接中枢并等待设备上报后，这里会显示实时状态。
        </M3Banner>
      ) : null}

      <OnboardingGuide />

      <div className="workspace-overview-toolbar" role="group" aria-label="总览图表设置">
        <M3SegmentedControl
          options={[
            { value: "cpu", label: "CPU" },
            { value: "memory", label: "内存" },
            { value: "disk", label: "磁盘" },
            { value: "network", label: "网络" }
          ]}
          value={observationMetric}
          onChange={(value) => setObservationMetric(value as FleetMetric)}
          aria-label="总览观察指标"
        />
        <div className="workspace-overview-toolbar__right">
          {canAggregateByGroup && (
            <M3SegmentedControl
              size="sm"
              options={[
                { value: "group", label: "按设备组" },
                { value: "device", label: "按单机" }
              ]}
              value={effectiveGranularity}
              onChange={(value) => setUserTrendGranularity(value as TrendGranularity)}
              aria-label="趋势聚合粒度"
            />
          )}
          <MetricWindowControl value={metricsWindow as DesktopMetricWindowValue} onChange={(value) => setMetricsWindow(value)} />
        </div>
      </div>

      {activeGroupFilter === "all" && hasNamedGroups && (
        <GroupOverviewGrid
          groups={groups}
          thresholds={healthThresholds}
          groupTrends={trendsByGroup}
          groupNetworkRates={groupNetworkRates}
          metric={observationMetric}
          windowLabel={metricWindowLabel}
          onFocusGroup={(groupKey) => changeGroupFilter(groupKey)}
          onOpenGroupDirectory={(groupKey) => navigate({ kind: "devices", group: groupKey })}
        />
      )}

      <div className="workspace-overview-main">
        <section id="section-observation" className="workspace-overview-trend" aria-label="资源趋势">
          <RenderBoundary
            scope="tile"
            title={`${observationLabels[observationMetric]}趋势`}
            resetKey={`${observationMetric}:${effectiveGranularity}:${activeGroupFilter}`}
          >
            <ChartTile
              title={`${observationLabels[observationMetric]} · ${effectiveGranularity === "group" ? "各设备组对比" : activeGroupName}`}
              subtitle={`最近 ${metricWindowLabel}`}
              emptyMessage={observationEmptyMessage}
              sheet={
                <DeviceChartSheet
                  tile={{
                    key: "overview-observation",
                    title: `${observationLabels[observationMetric]}趋势 · ${effectiveGranularity === "group" ? "设备组对比" : activeGroupName}`,
                    subtitle: `${effectiveGranularity === "group" ? "每个设备组一条聚合线" : "每台设备一条数据线"} · 最近 ${metricWindowLabel}${observationNote ? ` · ${observationNote}` : ""}`,
                    series: observationSeries
                  }}
                />
              }
            >
              <TimeSeriesChart
                series={observationSeries}
                maxValue={isPercentAxis ? 100 : undefined}
                height={300}
                thresholds={thresholdMetric ? thresholdLines(healthThresholds[thresholdMetric]) : undefined}
                inspectionToleranceMs={2500}
                onDrillDownSeries={
                  effectiveGranularity === "group"
                    ? (groupKey) => changeGroupFilter(groupKey)
                    : (deviceId) => navigate({ kind: "device", deviceId })
                }
              />
              {observationNote ? <p className="chart-tile__note">{observationNote}</p> : null}
            </ChartTile>
          </RenderBoundary>
        </section>

        <Surface className="workspace-overview-devices">
          <div className="workspace-surface__header">
            <div>
              <span className="workspace-section-kicker">
                {activeGroupSummary ? `需要关注 · ${activeGroupSummary.name}` : "需要关注"}
              </span>
              <h3>
                {health.issues.length
                  ? `${health.issues.length} 项问题 · ${attentionCount ?? 0} 台设备`
                  : "没有需要处理的设备"}
              </h3>
            </div>
            <Button variant="quiet" onClick={() => openSettings("general")}>调整阈值</Button>
          </div>
          {cached && <div className="workspace-inline-note">当前为缓存快照，设备状态可能已经变化。</div>}
          {health.issues.length ? (
            <DeviceIssueList
              issues={health.issues}
              deviceGroups={activeGroupFilter === "all" ? deviceGroupsById : undefined}
              onOpen={(deviceId) => navigate({ kind: "device", deviceId })}
            />
          ) : (
            <div className="workspace-muted-block">
              {noData
                ? "还没有设备接入；Agent 上报一次后就会出现在这里。"
                : `${health.total} 台设备全部在线，资源都在阈值以内。`}
            </div>
          )}
        </Surface>
      </div>

      {scopedDevices.length ? (
        <section className="workspace-fleet" aria-labelledby="workspace-fleet-title">
          <header className="workspace-fleet__header">
            <h3 id="workspace-fleet-title">
              {activeGroupFilter === "all" ? "单机水位一览" : `组内设备一览 · ${activeGroupName}`}
            </h3>
            <span>需要关注的排在前面 · 条上的刻度是警告与严重阈值</span>
          </header>
          <FleetGrid
            devices={scopedDevices}
            trends={trendsByDevice}
            metric={observationMetric}
            windowLabel={metricWindowLabel}
            thresholds={healthThresholds}
            showGroupBadge={activeGroupFilter === "all"}
            onOpen={(deviceId) => navigate({ kind: "device", deviceId })}
          />
        </section>
      ) : null}

      <HubStatusCard
        state={
          globalHealth.source === "live"
            ? "online"
            : globalHealth.source === "cache"
              ? "cached"
              : globalHealth.source === "unknown"
                ? "warning"
                : "unknown"
        }
        stateLabel={globalHealth.sourceLabel}
        endpoint={snapshot.localBackend?.config.connection.serverUrl ?? "由当前站点提供"}
        syncedAt={snapshot ? formatDate(snapshot.generatedAt) : "尚未同步"}
        total={globalHealth.total}
        online={globalHealth.online}
        refreshing={refreshing}
        onRefresh={() => void refresh()}
        onOpenSettings={() => openSettings("connections")}
      />
    </div>
  );
}

function HubStatusCard({
  state,
  stateLabel,
  endpoint,
  syncedAt,
  total,
  online,
  refreshing,
  onRefresh,
  onOpenSettings
}: {
  state: "online" | "offline" | "cached" | "warning" | "unknown";
  stateLabel: string;
  endpoint: string;
  syncedAt: string;
  total: number;
  online: number;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <Surface className="workspace-hub-card">
      <div className="workspace-surface__header">
        <div>
          <span className="workspace-section-kicker">中枢</span>
          <h3>连接与同步</h3>
        </div>
        <StatusLabel state={state} />
      </div>
      <div className="workspace-hub-card__grid">
        <SummaryRow
          label="当前状态"
          value={stateLabel}
          tone={state === "online" ? "success" : state === "warning" || state === "offline" ? "warning" : undefined}
        />
        <SummaryRow label="中枢地址" value={endpoint} />
        <SummaryRow label="最近同步" value={syncedAt} />
        <SummaryRow label="设备范围" value={`${total} 台已接入 · ${online} 台在线`} />
      </div>
      <div className="workspace-form__actions">
        <Button variant="quiet" onClick={onRefresh} disabled={refreshing}>
          <Icon name="refresh" size={15} />
          {refreshing ? "正在刷新" : "立即刷新"}
        </Button>
        <Button variant="quiet" onClick={onOpenSettings}>
          连接设置<Icon name="arrow" size={15} />
        </Button>
      </div>
    </Surface>
  );
}
