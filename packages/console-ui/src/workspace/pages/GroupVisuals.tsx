import React, { useState } from "react";
import type { SamplePoint } from "@dsc/shared";
import { CapacityBar, Sparkline } from "../charts";
import { M3Badge } from "../m3";
import { Icon, StatusDot, Surface } from "../ui";
import { formatBytes, formatPercent, formatRate } from "../formatters";
import { metricTone, type HealthThresholds } from "../health";
import type { DeviceGroupSummary } from "../selectors";
import {
  latestPointValue,
  type FleetMetric,
  type GroupNetworkRateSummary
} from "../fleetTrends";
import {
  isDeviceGroupDragEvent,
  readDroppedDeviceIds
} from "../deviceGroupDnd";
import { FleetGrid } from "./FleetGrid";

const METRIC_LABELS: Record<FleetMetric, string> = {
  cpu: "CPU 均值",
  memory: "内存池占比",
  disk: "存储池占比",
  network: "总网络吞吐"
};

export function GroupHealthBar({
  group,
  className = ""
}: {
  group: DeviceGroupSummary;
  className?: string;
}) {
  if (group.total <= 0) return null;
  const normalPct = (group.normalOnlineCount / group.total) * 100;
  const warningPct = (group.warningCount / group.total) * 100;
  const criticalPct = (group.criticalCount / group.total) * 100;
  const offlinePct = (group.offline / group.total) * 100;
  const summaryText = [
    group.normalOnlineCount > 0 ? `${group.normalOnlineCount} 台正常` : "",
    group.warningCount > 0 ? `${group.warningCount} 台警告` : "",
    group.criticalCount > 0 ? `${group.criticalCount} 台严重` : "",
    group.offline > 0 ? `${group.offline} 台离线` : ""
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <span
      className={`workspace-group-health-bar${className ? ` ${className}` : ""}`}
      role="img"
      aria-label={`组健康分布：${summaryText}`}
      title={summaryText}
    >
      {normalPct > 0 && (
        <span
          className="workspace-group-health-bar__seg is-normal"
          style={{ width: `${normalPct}%` }}
        />
      )}
      {warningPct > 0 && (
        <span
          className="workspace-group-health-bar__seg is-warning"
          style={{ width: `${warningPct}%` }}
        />
      )}
      {criticalPct > 0 && (
        <span
          className="workspace-group-health-bar__seg is-critical"
          style={{ width: `${criticalPct}%` }}
        />
      )}
      {offlinePct > 0 && (
        <span
          className="workspace-group-health-bar__seg is-offline"
          style={{ width: `${offlinePct}%` }}
        />
      )}
    </span>
  );
}

export function formatGroupPoolCaption(
  usedBytes: number | null,
  totalBytes: number | null,
  fallbackLabel = "容量待上报"
): string {
  if (usedBytes == null || totalBytes == null || totalBytes <= 0) return fallbackLabel;
  return `${formatBytes(usedBytes)} / ${formatBytes(totalBytes)}`;
}

export function GroupOverviewGrid({
  groups,
  thresholds,
  groupTrends,
  groupNetworkRates,
  metric,
  windowLabel,
  onFocusGroup,
  onOpenGroupDirectory
}: {
  groups: readonly DeviceGroupSummary[];
  thresholds: HealthThresholds;
  groupTrends: ReadonlyMap<string, readonly SamplePoint[]>;
  groupNetworkRates: ReadonlyMap<string, GroupNetworkRateSummary>;
  metric: FleetMetric;
  windowLabel: string;
  onFocusGroup: (groupKey: string) => void;
  onOpenGroupDirectory: (groupKey: string) => void;
}) {
  if (!groups.length) return null;
  return (
    <section className="workspace-group-bento" aria-labelledby="workspace-group-bento-title">
      <header className="workspace-fleet__header">
        <div>
          <span className="workspace-section-kicker">设备组全景对比</span>
          <h3 id="workspace-group-bento-title">分组容量池与负载短板</h3>
        </div>
        <span>点击卡片聚焦该组趋势 · 内存与存储按全组真实字节容量加权汇总</span>
      </header>
      <ul className="workspace-group-bento__grid" aria-label="设备组对比卡片">
        {groups.map((group) => {
          const online = group.online > 0;
          const memPct = group.pooledMemoryPercent ?? group.avgMemoryPercent;
          const diskPct = group.pooledDiskPercent ?? group.avgDiskPercent;
          const cpuTone = online
            ? metricTone(
                group.maxCpu && group.maxCpu.severity !== "normal"
                  ? group.maxCpu.percent
                  : group.avgCpuPercent,
                thresholds.cpu
              )
            : "normal";
          const memTone = online
            ? metricTone(
                group.maxMemory && group.maxMemory.severity !== "normal"
                  ? Math.max(memPct ?? 0, group.maxMemory.percent)
                  : memPct,
                thresholds.memory
              )
            : "normal";
          const diskTone = online
            ? metricTone(
                group.maxDisk && group.maxDisk.severity !== "normal"
                  ? Math.max(diskPct ?? 0, group.maxDisk.percent)
                  : diskPct,
                thresholds.disk
              )
            : "normal";
          const net = groupNetworkRates.get(group.key);
          const points = groupTrends.get(group.key) ?? [];
          const latest = latestPointValue(points);
          const trendTone =
            metric === "network" ? "normal" : online ? metricTone(latest, thresholds[metric]) : "normal";

          return (
            <li key={group.key} className="workspace-group-bento__item">
              <div className={`workspace-group-card is-${group.state}`}>
                <div className="workspace-group-card__top">
                  <button
                    type="button"
                    className="workspace-group-card__lead"
                    onClick={() => onFocusGroup(group.key)}
                    title={`在总览中聚焦查看「${group.name}」`}
                  >
                    <StatusDot state={group.state} />
                    <strong className="workspace-group-card__name">{group.name}</strong>
                    <M3Badge
                      tone={
                        group.online === 0
                          ? "neutral"
                          : group.criticalCount > 0
                            ? "error"
                            : group.warningCount > 0 || group.offline > 0
                              ? "warning"
                              : "success"
                      }
                    >
                      {`${group.online}/${group.total} 在线`}
                    </M3Badge>
                  </button>
                  <button
                    type="button"
                    className="workspace-group-card__dir-btn"
                    onClick={() => onOpenGroupDirectory(group.key)}
                    aria-label={`打开 ${group.name} 设备目录`}
                    title={`进入「${group.name}」设备列表`}
                  >
                    <span>目录</span>
                    <Icon name="arrow" size={14} />
                  </button>
                </div>

                <GroupHealthBar group={group} />

                <button
                  type="button"
                  className="workspace-group-card__body"
                  onClick={() => onFocusGroup(group.key)}
                  aria-label={`聚焦查看分组 ${group.name}`}
                >
                  <div className="workspace-group-card__metrics">
                    <div className={`workspace-group-card__metric is-${cpuTone}`}>
                      <div className="workspace-group-card__metric-head">
                        <span>CPU 均值</span>
                        <strong>{formatPercent(group.avgCpuPercent)}</strong>
                      </div>
                      <CapacityBar percent={group.avgCpuPercent} tone={cpuTone} marks={thresholds.cpu} size="sm" />
                      {group.total > 1 && group.maxCpu ? (
                        <small className={group.maxCpu.severity !== "normal" ? `is-${group.maxCpu.severity}` : undefined}>
                          峰值 {group.maxCpu.hostname} {formatPercent(group.maxCpu.percent)}
                        </small>
                      ) : (
                        <small>{online ? "在线实例负载" : "暂无在线上报"}</small>
                      )}
                    </div>

                    <div className={`workspace-group-card__metric is-${memTone}`}>
                      <div className="workspace-group-card__metric-head">
                        <span>内存池</span>
                        <strong>{formatPercent(memPct)}</strong>
                      </div>
                      <CapacityBar percent={memPct} tone={memTone} marks={thresholds.memory} size="sm" />
                      <small>
                        {formatGroupPoolCaption(group.memoryUsedBytes, group.memoryTotalBytes, "按上报均值统计")}
                        {group.total > 1 && group.maxMemory && group.maxMemory.severity !== "normal"
                          ? ` · 最高 ${group.maxMemory.hostname} ${formatPercent(group.maxMemory.percent)}`
                          : ""}
                      </small>
                    </div>

                    <div className={`workspace-group-card__metric is-${diskTone}`}>
                      <div className="workspace-group-card__metric-head">
                        <span>存储池</span>
                        <strong>{formatPercent(diskPct)}</strong>
                      </div>
                      <CapacityBar percent={diskPct} tone={diskTone} marks={thresholds.disk} size="sm" />
                      <small>
                        {formatGroupPoolCaption(group.diskUsedBytes, group.diskTotalBytes, "按上报均值统计")}
                        {group.total > 1 && group.maxDisk && group.maxDisk.severity !== "normal"
                          ? ` · 最高 ${group.maxDisk.hostname} ${formatPercent(group.maxDisk.percent)}`
                          : ""}
                      </small>
                    </div>
                  </div>

                  <div className="workspace-group-card__footer">
                    <div className="workspace-group-card__net">
                      <span>实时总网速</span>
                      <strong>
                        {net && net.reportingCount > 0
                          ? `↓ ${formatRate(net.rxBytesPerSec)} · ↑ ${formatRate(net.txBytesPerSec)}`
                          : "—"}
                      </strong>
                    </div>
                    <div className="workspace-group-card__spark">
                      <span className="workspace-group-card__spark-head">
                        <span>{METRIC_LABELS[metric]} · {windowLabel}</span>
                        <strong>
                          {latest == null
                            ? "—"
                            : metric === "network"
                              ? formatRate(latest)
                              : formatPercent(latest)}
                        </strong>
                      </span>
                      <Sparkline
                        points={points}
                        maxValue={metric === "network" ? undefined : 100}
                        tone={trendTone}
                        height={28}
                      />
                    </div>
                  </div>
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function GroupScopeTelemetryStrip({
  group,
  thresholds,
  networkRate,
  cpuSparkline
}: {
  group: DeviceGroupSummary;
  thresholds: HealthThresholds;
  networkRate?: GroupNetworkRateSummary;
  cpuSparkline?: readonly SamplePoint[];
}) {
  const online = group.online > 0;
  const memPct = group.pooledMemoryPercent ?? group.avgMemoryPercent;
  const diskPct = group.pooledDiskPercent ?? group.avgDiskPercent;
  const cpuTone = online ? metricTone(group.avgCpuPercent, thresholds.cpu) : "normal";
  const memTone = online ? metricTone(memPct, thresholds.memory) : "normal";
  const diskTone = online ? metricTone(diskPct, thresholds.disk) : "normal";

  return (
    <Surface className="workspace-group-scope-strip" aria-label={`${group.name} 组级资源汇总`}>
      <div className="workspace-group-scope-strip__cell">
        <div className="workspace-group-scope-strip__head">
          <span>组在线与健康度</span>
          <strong>{`${group.online}/${group.total} 在线`}</strong>
        </div>
        <GroupHealthBar group={group} />
        <small>
          {group.overThreshold > 0
            ? `${group.overThreshold} 台超限${group.offline > 0 ? ` · ${group.offline} 台离线` : ""}`
            : group.offline > 0
              ? `${group.offline} 台设备离线`
              : "组内设备全部正常上报"}
        </small>
      </div>

      <div className="workspace-group-scope-strip__cell">
        <div className="workspace-group-scope-strip__head">
          <span>CPU 负载</span>
          <strong>{formatPercent(group.avgCpuPercent)}</strong>
        </div>
        <CapacityBar percent={group.avgCpuPercent} tone={cpuTone} marks={thresholds.cpu} size="sm" />
        <small>
          {group.maxCpu
            ? `最高 ${group.maxCpu.hostname} (${formatPercent(group.maxCpu.percent)})`
            : "暂无在线 CPU 样本"}
        </small>
      </div>

      <div className="workspace-group-scope-strip__cell">
        <div className="workspace-group-scope-strip__head">
          <span>内存池总量</span>
          <strong>{formatPercent(memPct)}</strong>
        </div>
        <CapacityBar percent={memPct} tone={memTone} marks={thresholds.memory} size="sm" />
        <small>{formatGroupPoolCaption(group.memoryUsedBytes, group.memoryTotalBytes)}</small>
      </div>

      <div className="workspace-group-scope-strip__cell">
        <div className="workspace-group-scope-strip__head">
          <span>存储池总量</span>
          <strong>{formatPercent(diskPct)}</strong>
        </div>
        <CapacityBar percent={diskPct} tone={diskTone} marks={thresholds.disk} size="sm" />
        <small>{formatGroupPoolCaption(group.diskUsedBytes, group.diskTotalBytes)}</small>
      </div>

      <div className="workspace-group-scope-strip__cell">
        <div className="workspace-group-scope-strip__head">
          <span>组总网络吞吐</span>
          <strong>
            {networkRate && networkRate.reportingCount > 0
              ? `↓ ${formatRate(networkRate.rxBytesPerSec)}`
              : "—"}
          </strong>
        </div>
        {cpuSparkline && cpuSparkline.length > 1 ? (
          <Sparkline points={cpuSparkline} maxValue={100} tone={cpuTone} height={22} />
        ) : null}
        <small>
          {networkRate && networkRate.reportingCount > 0
            ? `上行 ↑ ${formatRate(networkRate.txBytesPerSec)} · ${networkRate.reportingCount} 台上报`
            : "等待实时速率样本"}
        </small>
      </div>
    </Surface>
  );
}

export function GroupedCardSwimlanes({
  groups,
  thresholds,
  cpuTrends,
  groupNetworkRates,
  windowLabel,
  canManage,
  onOpenDevice,
  onEditDeviceGroup,
  onManageMembers,
  onRenameGroup,
  onDissolveGroup,
  onDropDevices
}: {
  groups: readonly DeviceGroupSummary[];
  thresholds: HealthThresholds;
  cpuTrends: ReadonlyMap<string, readonly SamplePoint[]>;
  groupNetworkRates: ReadonlyMap<string, GroupNetworkRateSummary>;
  windowLabel: string;
  canManage: boolean;
  onOpenDevice: (deviceId: string) => void;
  onEditDeviceGroup?: (device: import("@dsc/shared").DeviceSummary) => void;
  onManageMembers?: (group: DeviceGroupSummary) => void;
  onRenameGroup?: (group: DeviceGroupSummary) => void;
  onDissolveGroup?: (group: DeviceGroupSummary) => void;
  onDropDevices?: (deviceIds: string[], targetGroup: string | null) => void;
}) {
  const [dropKey, setDropKey] = useState<string | null>(null);

  return (
    <div className="workspace-group-swimlanes">
      {groups.map((group) => {
        const memPct = group.pooledMemoryPercent ?? group.avgMemoryPercent;
        const diskPct = group.pooledDiskPercent ?? group.avgDiskPercent;
        const net = groupNetworkRates.get(group.key);
        const isDropTarget = dropKey === group.key;

        return (
          <Surface
            key={group.key}
            className={`workspace-group-swimlane${isDropTarget ? " is-drop-target" : ""}`}
            onDragOver={
              canManage && onDropDevices
                ? (event: React.DragEvent<HTMLElement>) => {
                    if (!isDeviceGroupDragEvent(event)) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    if (dropKey !== group.key) setDropKey(group.key);
                  }
                : undefined
            }
            onDragLeave={
              canManage && onDropDevices
                ? (event: React.DragEvent<HTMLElement>) => {
                    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                    if (dropKey === group.key) setDropKey(null);
                  }
                : undefined
            }
            onDrop={
              canManage && onDropDevices
                ? (event: React.DragEvent<HTMLElement>) => {
                    if (!isDeviceGroupDragEvent(event)) return;
                    event.preventDefault();
                    setDropKey(null);
                    const ids = readDroppedDeviceIds(event);
                    if (ids.length > 0) {
                      onDropDevices(ids, group.isUngrouped ? null : group.name);
                    }
                  }
                : undefined
            }
          >
            <header className="workspace-group-swimlane__header">
              <div className="workspace-group-swimlane__lead">
                <StatusDot state={group.state} />
                <h3>{group.name}</h3>
                <M3Badge
                  tone={
                    group.online === 0
                      ? "neutral"
                      : group.criticalCount > 0
                        ? "error"
                        : group.warningCount > 0 || group.offline > 0
                          ? "warning"
                          : "success"
                  }
                >
                  {`${group.online}/${group.total} 在线`}
                </M3Badge>
                {group.overThreshold > 0 && (
                  <M3Badge tone={group.criticalCount > 0 ? "error" : "warning"}>
                    {`${group.overThreshold} 台超限`}
                  </M3Badge>
                )}
              </div>

              <div className="workspace-group-swimlane__pills">
                <span>CPU {formatPercent(group.avgCpuPercent)}{group.maxCpu && group.total > 1 ? `（峰 ${formatPercent(group.maxCpu.percent)}）` : ""}</span>
                <span>内存池 {formatGroupPoolCaption(group.memoryUsedBytes, group.memoryTotalBytes, formatPercent(memPct))}</span>
                <span>存储池 {formatGroupPoolCaption(group.diskUsedBytes, group.diskTotalBytes, formatPercent(diskPct))}</span>
                {net && net.reportingCount > 0 && (
                  <span>网速 ↓ {formatRate(net.rxBytesPerSec)} / ↑ {formatRate(net.txBytesPerSec)}</span>
                )}
              </div>

              {canManage && (
                <div className="workspace-group-section__actions">
                  {onManageMembers && (
                    <button
                      type="button"
                      className="workspace-group-section__action"
                      onClick={() => onManageMembers(group)}
                    >
                      {group.isUngrouped ? "批量归组" : "管理成员"}
                    </button>
                  )}
                  {!group.isUngrouped && onRenameGroup && (
                    <button
                      type="button"
                      className="workspace-group-section__action"
                      onClick={() => onRenameGroup(group)}
                    >
                      重命名
                    </button>
                  )}
                  {!group.isUngrouped && onDissolveGroup && (
                    <button
                      type="button"
                      className="workspace-group-section__action is-danger"
                      onClick={() => onDissolveGroup(group)}
                    >
                      解散
                    </button>
                  )}
                </div>
              )}
            </header>

            <GroupHealthBar group={group} />

            <FleetGrid
              devices={group.devices}
              trends={cpuTrends}
              metric="cpu"
              windowLabel={windowLabel}
              thresholds={thresholds}
              showGroupBadge={false}
              enableDragToGroup={canManage && Boolean(onDropDevices)}
              onEditGroup={canManage ? onEditDeviceGroup : undefined}
              onOpen={onOpenDevice}
            />
          </Surface>
        );
      })}
    </div>
  );
}
