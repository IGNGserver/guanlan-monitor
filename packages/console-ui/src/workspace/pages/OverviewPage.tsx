import React, { useState } from "react";
import { ActionableNotification } from "@carbon/react";
import { useWorkspace } from "../WorkspaceContext";
import { Button, Icon, StatusLabel, Surface, SummaryRow } from "../ui";
import { M3SegmentedControl } from "../m3";
import { CarbonTimeSeriesChart } from "../CarbonCharts";
import { ChartTile, DashboardCell, DashboardGrid, DashboardSection } from "../dashboard";
import { OnboardingGuide } from "../shell/OnboardingGuide";
import { formatBytes, formatDate, formatPercent } from "../formatters";
import { selectAttentionDevices, selectHealthSummary } from "../selectors";
import { CarbonDeviceTable, DeviceCardGrid, EmptyState, ErrorSurface, isMetricUnavailable, LoadingSurface, PageIntro, OverviewSummary, SnapshotFreshnessNotice, unavailablePoints } from "./shared";

type ObservationMetric = "cpu" | "memory" | "disk" | "network";

const observationLabels: Record<ObservationMetric, string> = {
  cpu: "CPU 使用率",
  memory: "内存占用",
  disk: "磁盘已用容量",
  network: "网络吞吐"
};

/**
 * Where to send the reader when the shell itself has nothing to show.
 *
 * The two shells fail for different reasons: the desktop client reads the hub
 * through the host bridge it owns, while a browser tab talks to the hub through
 * this site with a session key. One fallback sentence covered both, so web
 * readers were told to reopen a desktop app that was never involved.
 */
function failureGuide(isDesktopShell: boolean): string {
  return isDesktopShell
    ? "桌面桥接尚未准备好。请重新打开观澜后再试。"
    : "网页端通过当前站点读取中枢。请刷新页面重试；如果仍然读不到，请到“设置 · 连接”用访问密钥重新完成认证，并确认站点配置的中枢地址正在运行。";
}

/**
 * The overview answers one question first: is anything wrong, and where.
 *
 * The standalone hub page was folded in here as a card, because it held four
 * facts about the connection and a button pointing back at this list; a third
 * destination for that was one more place to remember. Device rows live only in
 * the directory now — this page surfaces the devices that cannot answer for
 * themselves, and says so plainly when there are none.
 */
export function OverviewPage() {
  const { snapshot, allDevices, metricsWindow, loading, refreshing, error, refresh, openSettings, navigate, capabilities } = useWorkspace();
  const [observationMetric, setObservationMetric] = useState<ObservationMetric>("cpu");
  if (loading && !snapshot) return <LoadingSurface />;
  if (!snapshot) return <ErrorSurface title="无法读取设备状态" detail={error ?? failureGuide(capabilities.canControlNativeWindow)} onRetry={() => void refresh()} />;

  const health = selectHealthSummary(snapshot, allDevices, formatDate);
  const cached = health.source === "cache";
  const noData = health.total === 0;
  const hubAbnormal = health.source === "cache" || health.source === "unknown";
  const attentionDevices = selectAttentionDevices(allDevices);
  const localIssues = snapshot.localBackend?.lastIssueCount ?? 0;
  const overviewInstances = snapshot.overviewMetrics?.instances ?? [];
  const metricWindowLabel = ({ "1m": "1 分钟", "5m": "5 分钟", "15m": "15 分钟", "1h": "1 小时", "6h": "6 小时", "24h": "1 天", "1d": "1 天", "7d": "1 周", "1w": "1 周", "30d": "1 个月", "1mo": "1 个月", "90d": "90 天", "1y": "1 年" } as Record<string, string>)[metricsWindow] ?? metricsWindow;
  const attentionCount = health.pending;
  // Spell out what the number is made of so it can be checked, not believed.
  // The device half says 离线 — the same word the directory tags, the filter
  // chips and the device page use. "未响应" used to name that identical state
  // here only, so a reader counted two kinds of trouble.
  const attentionDetail = attentionCount == null
    ? "连接状态异常，暂无法判断"
    : attentionCount === 0
      ? "当前没有需要关注的项目"
      : [health.offline ? `${health.offline} 台设备离线` : "", localIssues ? `${localIssues} 条本机采集问题` : ""].filter(Boolean).join(" · ");
  const tone = hubAbnormal ? "warning" : noData ? "empty" : attentionCount ? "warning" : "normal";

  const observationSeries = overviewInstances.flatMap((instance) => {
    const unavailable = (key: Parameters<typeof isMetricUnavailable>[1]) => instance.unavailableMetrics?.includes(key) ?? false;
    if (observationMetric === "cpu") return [{ label: instance.hostname, points: unavailablePoints(instance.cpuUsagePercent, unavailable("cpuUsage")), valueFormatter: formatPercent }];
    if (observationMetric === "memory") return [{ label: instance.hostname, points: unavailablePoints(instance.memoryUsedBytes, unavailable("memoryUsage")), valueFormatter: formatBytes }];
    if (observationMetric === "disk") return [{ label: instance.hostname, points: unavailablePoints(instance.diskUsedBytes, unavailable("diskUsage")), valueFormatter: formatBytes }];
    return [
      { label: instance.hostname + " · Rx", points: unavailablePoints(instance.networkRxBytesPerSec, unavailable("networkRxRate")), valueFormatter: (value: number) => (Number.isFinite(value) && value > 0 ? formatBytes(value) + "/s" : "0 B/s") },
      { label: instance.hostname + " · Tx", points: unavailablePoints(instance.networkTxBytesPerSec, unavailable("networkTxRate")), valueFormatter: (value: number) => (Number.isFinite(value) && value > 0 ? formatBytes(value) + "/s" : "0 B/s") }
    ];
  });
  const observationHasData = observationSeries.some((series) => series.points.length > 0);
  const observationEmptyMessage = overviewInstances.length
    ? observationHasData ? undefined : observationLabels[observationMetric] + "暂无可用数据（缺失指标不会被估算）"
    : "当前还没有任何设备的总览样本";

  return <div className="workspace-page workspace-page--overview">
    <PageIntro
      tone={tone}
      eyebrow="总览"
      title={hubAbnormal ? "中枢连接异常" : noData ? "等待设备接入" : attentionCount ? `${attentionCount} 项需要关注` : "系统状态正常"}
      description={health.source === "empty"
        ? "还没有收到任何设备的实时状态。Agent 上报一次后，设备会自动出现在这里。"
        : hubAbnormal
          ? cached ? "当前显示的是离线缓存，" + health.sourceDetail + "；无法确认中枢现在的状态。" : "无法连接到中枢。请检查中枢地址与访问密钥。"
          : health.sourceDetail + "。统计覆盖全部已接入设备。"}
      actions={<><Button variant="quiet" onClick={() => openSettings("connections")}><Icon name="connection" size={16} />连接设置</Button><Button variant="primary" onClick={() => navigate({ kind: "devices" })}>查看全部设备<Icon name="arrow" size={16} /></Button></>}
    />

    {/* When the hub itself is unreachable the notification below already says the
        data may be expired; this one covers the quieter failure — a live
        snapshot that simply stopped refreshing. */}
    {!hubAbnormal && <SnapshotFreshnessNotice />}

    <OverviewSummary
      total={health.total}
      online={health.online}
      offline={health.offline}
      attentionCount={attentionCount}
      attentionDetail={attentionDetail}
      sourceLabel={health.sourceLabel}
      sourceState={health.source === "live" ? "online" : health.source === "cache" ? "cached" : health.source === "unknown" ? "warning" : "unknown"}
      sourceDetail={health.sourceDetail}
    />

    {hubAbnormal ? <ActionableNotification
      inline
      className="workspace-attention"
      kind="warning"
      lowContrast
      hasFocus={false}
      hideCloseButton
      title="中枢连接异常"
      subtitle={cached ? "无法取得最新数据，页面中的设备信息可能已经过期。" : "无法连接到中枢，请检查中枢地址与访问密钥后重试。"}
      actionButtonLabel="连接设置"
      onActionButtonClick={() => openSettings("connections")}
    /> : (health.source === "empty" || (attentionCount ?? 0) > 0) ? <ActionableNotification
      inline
      className="workspace-attention"
      kind={noData ? "info" : "warning"}
      lowContrast
      hasFocus={false}
      hideCloseButton
      title={noData ? "还没有可用设备" : "设备状态存在异常"}
      subtitle={noData ? "连接中枢并等待设备上报后，这里会显示实时状态。" : attentionDetail + "。"}
      actionButtonLabel={noData ? "配置数据来源" : "查看设备"}
      onActionButtonClick={() => noData ? openSettings("connections") : navigate({ kind: "devices" })}
    /> : null}

    <OnboardingGuide />

    <HubStatusCard
      state={health.source === "live" ? "online" : health.source === "cache" ? "cached" : health.source === "unknown" ? "warning" : "unknown"}
      stateLabel={health.sourceLabel}
      endpoint={snapshot.localBackend?.config.connection.serverUrl ?? "由当前站点提供"}
      syncedAt={snapshot ? formatDate(snapshot.generatedAt) : "尚未同步"}
      total={health.total}
      online={health.online}
      refreshing={refreshing}
      onRefresh={() => void refresh()}
      onOpenSettings={() => openSettings("connections")}
    />

    <Surface className="workspace-overview-devices">
      <div className="workspace-surface__header">
        <div><span className="workspace-section-kicker">需要关注</span><h3>{attentionDevices.length ? `${attentionDevices.length} 台设备离线` : "没有需要处理的设备"}</h3></div>
        <Button variant="quiet" onClick={() => navigate({ kind: "devices" })}>查看全部设备</Button>
      </div>
      {cached && <div className="workspace-inline-note">当前为缓存快照，设备列表只读。</div>}
      {attentionDevices.length
        ? (
          <div className="workspace-attention-content">
            <div className="workspace-attention-cards">
              <DeviceCardGrid devices={attentionDevices} />
            </div>
            <div className="workspace-visually-hidden" aria-hidden="true">
              <CarbonDeviceTable devices={attentionDevices} />
            </div>
          </div>
        )
        : <div className="workspace-muted-block">{noData ? "还没有设备接入；Agent 上报一次后就会出现在这里。" : `${health.total} 台设备全部在线，无需处理。到“设备”页可以搜索、筛选和管理。`}</div>}
    </Surface>

    <DashboardSection
      id="section-observation"
      eyebrow="资源趋势"
      title={`${observationLabels[observationMetric]} · 全部设备`}
      description="一张图只观察一个维度；缺失指标会明确留空，不会用估算值填充。"
      controls={<M3SegmentedControl options={[{ value: "cpu", label: "CPU" }, { value: "memory", label: "内存" }, { value: "disk", label: "磁盘" }, { value: "network", label: "网络" }]} value={observationMetric} onChange={(value) => setObservationMetric(value as ObservationMetric)} aria-label="总览观察指标" />}
    >
      <DashboardGrid>
        <DashboardCell span="full">
          <ChartTile
            title={`${observationLabels[observationMetric]}趋势`}
            subtitle={`每台设备一条数据线 · 最近 ${metricWindowLabel}`}
            emptyMessage={observationEmptyMessage}
          >
            <CarbonTimeSeriesChart series={observationSeries} maxValue={observationMetric === "cpu" ? 100 : undefined} />
          </ChartTile>
        </DashboardCell>
      </DashboardGrid>
    </DashboardSection>
  </div>;
}

/**
 * The hub facts that used to own a navigation entry. They are one row of the
 * overview now: connection state, where it points, when it last answered, and
 * how much of the fleet is reporting.
 */
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
        <div><span className="workspace-section-kicker">中枢</span><h3>连接与同步</h3></div>
        <StatusLabel state={state} />
      </div>
      <div className="workspace-hub-card__grid">
        <SummaryRow label="当前状态" value={stateLabel} tone={state === "online" ? "success" : state === "warning" || state === "offline" ? "warning" : undefined} />
        <SummaryRow label="中枢地址" value={endpoint} />
        <SummaryRow label="最近同步" value={syncedAt} />
        <SummaryRow label="设备范围" value={`${total} 台已接入 · ${online} 台在线`} />
      </div>
      <div className="workspace-form__actions">
        <Button variant="quiet" onClick={onRefresh} disabled={refreshing}><Icon name="refresh" size={15} />{refreshing ? "正在同步" : "立即同步"}</Button>
        <Button variant="quiet" onClick={onOpenSettings}>连接设置<Icon name="arrow" size={15} /></Button>
      </div>
    </Surface>
  );
}
