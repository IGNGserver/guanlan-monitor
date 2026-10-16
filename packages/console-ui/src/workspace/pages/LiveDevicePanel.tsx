import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ConsoleLivePort, LiveDocker, LiveMetrics as LiveMetricsData, LiveProcesses, LiveSnapshot, LiveTopic, SamplePoint } from "@dsc/shared";
import { startVisiblePolling } from "../../helpers/visiblePolling";
import { useLivePort } from "../WorkspaceContext";
import { formatBytes, formatDate } from "../formatters";
import { M3Banner, M3Select } from "../m3";
import { Button, Icon } from "../ui";
import { ChartReadout, TimeSeriesChart, type ChartInspection, type ChartSeries } from "../charts";
import { indexChartSamples, latestChartValues } from "../chartInspection.ts";
import { ChartTile, DashboardCell, DashboardGrid } from "../dashboard";
import { acceptsLiveSnapshot, containerRates, describeLiveError, isDisconnectedLiveError, isTransientLiveError, liveStatus, type ContainerRates, type LiveFailure, type LiveStatusTone } from "../livePresentation";
import "./live.css";

/**
 * What the device can answer live, read from the Hub's session table (never
 * from the device). `null` means "not known right now" — no session, no port,
 * not signed in — and callers must not hide a view on that basis alone.
 */
export function useLiveCapabilities(deviceId: string, enabled: boolean): LiveTopic[] | null {
  const port = useLivePort();
  const [capabilities, setCapabilities] = useState<LiveTopic[] | null>(null);
  useEffect(() => {
    setCapabilities(null);
    if (!port || !enabled) return;
    let stopped = false;
    port.getLiveConnection(deviceId)
      .then((connection) => { if (!stopped && connection.state === "ready") setCapabilities(connection.capabilities); })
      .catch(() => undefined);
    return () => { stopped = true; };
  }, [deviceId, enabled, port]);
  return capabilities;
}

/** Processes and containers are read every 2 s by default: a table needs a moment to be read between reorders. */
const defaultInterval: Record<LiveTopic, number> = { metrics: 1, processes: 2, docker: 2 };

/**
 * One live view of one device. Nothing is requested until this is mounted, and
 * unmounting it (switching tab or range) stops every request.
 */
export function LiveTopicPanel({ deviceId, topic, authenticated }: { deviceId: string; topic: LiveTopic; authenticated: boolean }) {
  const port = useLivePort();
  const [interval, setIntervalSeconds] = useState(defaultInterval[topic]);
  const [paused, setPaused] = useState(false);
  if (!port) return <M3Banner tone="info" title="当前客户端不支持实时查看">升级到最新版本的观澜客户端后即可使用。</M3Banner>;
  if (!authenticated) return <M3Banner tone="info" title="需要登录中枢">实时数据直接来自设备，离线缓存不能提供；连接并登录中枢后自动开始。</M3Banner>;
  // The interval is not part of the key: changing it must not discard the two-minute curve.
  return <LiveTopicView key={`${deviceId}:${topic}`} deviceId={deviceId} port={port} topic={topic} interval={interval} onIntervalChange={setIntervalSeconds} paused={paused} onPausedChange={setPaused} />;
}

const intervalOptions = [{ value: "1", label: "每 1 秒" }, { value: "2", label: "每 2 秒" }, { value: "5", label: "每 5 秒" }];

function LiveTopicView({ deviceId, port, topic, interval, onIntervalChange, paused, onPausedChange }: { deviceId: string; port: ConsoleLivePort; topic: LiveTopic; interval: number; onIntervalChange: (seconds: number) => void; paused: boolean; onPausedChange: (paused: boolean) => void }) {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [failure, setFailure] = useState<LiveFailure | null>(null);
  const [now, setNow] = useState(Date.now());
  const [lastConfirmed, setLastConfirmed] = useState(0);
  const [conflictAt, setConflictAt] = useState<string | null>(null);
  const [resetState, setResetState] = useState<"idle" | "pending" | "done" | "failed">("idle");
  const [samples, setSamples] = useState<LiveSample[]>([]);
  const [rates, setRates] = useState<Map<string, ContainerRates>>(new Map());
  const session = useRef<string | null>(null);
  const previousDocker = useRef<LiveDocker | null>(null);
  // While the device has no channel, poll only the connection state; ask for
  // data again once it is ready. One request per tick either way.
  const disconnected = useRef(false);
  useEffect(() => {
    // Paused means no request at all, not a slower one: the last result stays,
    // labelled as paused, until the reader resumes.
    if (paused) return;
    let stopped = false;
    const refreshConnection = async () => {
      const connection = await port.getLiveConnection(deviceId);
      if (stopped) return null;
      setConflictAt(connection.state === "ready" ? null : connection.identityConflictAt ?? null);
      return connection;
    };
    const stop = startVisiblePolling(async () => {
      try {
        if (disconnected.current) {
          const connection = await refreshConnection();
          if (!connection) return;
          if (connection.state !== "ready") throw new Error("device_not_connected");
          if (!connection.capabilities.includes(topic)) throw new Error("device_capability_unavailable");
          disconnected.current = false;
        }
        const started = performance.now();
        const result = await port.readLive(deviceId, topic);
        if (stopped) return;
        if (performance.now() - started > 6000) throw new Error("query_expired");
        if (!acceptsLiveSnapshot(result, deviceId, topic)) throw new Error("device_disconnected");
        const at = Date.now();
        const changedSession = session.current !== result.sessionId;
        session.current = result.sessionId;
        setSnapshot(result); setLastConfirmed(at); setNow(at); setFailure(null); setConflictAt(null);
        if (topic === "metrics") {
          // A failed or paused stretch simply has no samples; the chart breaks
          // the curve there instead of joining across time nobody observed.
          const data = result.data as LiveMetricsData;
          setSamples((previous) => [...(changedSession ? [] : previous.filter((sample) => sample.at >= at - LIVE_WINDOW_MS)), { at, data }].slice(-LIVE_SAMPLE_LIMIT));
        }
        if (topic === "docker") {
          const docker = result.data as LiveDocker;
          setRates(containerRates(changedSession ? null : previousDocker.current, docker));
          previousDocker.current = docker;
        }
      } catch (nextError) {
        if (stopped) return;
        setFailure(describeLiveError(nextError));
        // A busy or slow collection keeps the last result on screen, marked
        // stale, until it expires; anything else removes it immediately.
        if (!isTransientLiveError(nextError)) { setSnapshot(null); previousDocker.current = null; }
        if (isDisconnectedLiveError(nextError) && !disconnected.current) {
          disconnected.current = true;
          await refreshConnection().catch(() => null);
        }
      }
    }, interval * 1000, true);
    const stopClock = startVisiblePolling(async () => { setNow(Date.now()); }, 1000);
    return () => { stopped = true; stop(); stopClock(); };
  }, [deviceId, interval, paused, port, topic]);
  const expired = !paused && lastConfirmed > 0 && now - lastConfirmed > Math.max(6000, interval * 2000);
  const fresh = snapshot !== null && !expired;
  const age = Math.max(0, Math.floor((now - lastConfirmed) / 1000));
  const status = liveStatus({ paused, hasResult: snapshot !== null, expired, failure, ageSeconds: age });
  const reset = async () => {
    if (!port.resetLiveCredentials || !window.confirm("重置后，中枢会接受这台设备下一次以新身份登记的实时连接。仅在确认是你自己重装了 Agent 或丢失了密钥文件时操作。继续？")) return;
    setResetState("pending");
    try { await port.resetLiveCredentials(deviceId); setResetState("done"); }
    catch { setResetState("failed"); }
  };
  return <div className="workspace-live__body">
    <LiveStatusBar
      tone={status.tone}
      label={status.label}
      detail={snapshot ? `采集于 ${formatDate(snapshot.receivedAt)}` : null}
      paused={paused}
      onPausedChange={onPausedChange}
      interval={interval}
      onIntervalChange={onIntervalChange}
    />
    {conflictAt && <M3Banner
      tone="error"
      title="中枢拒绝了这台设备的实时登记"
      action={port.resetLiveCredentials ? <Button variant="quiet" disabled={resetState === "pending"} onClick={() => void reset()}>{resetState === "pending" ? "正在重置……" : "重置实时凭据"}</Button> : undefined}
    >
      <p>{formatDate(conflictAt)} 登记时，它的安装身份与已登记的不一致，常见原因是重装了 Agent 或删除了 Agent 配置目录。历史上报不受影响。</p>
      {resetState === "failed" && <p>重置失败，请检查登录状态后重试。</p>}
    </M3Banner>}
    {/* Outside the conflict banner: the conflict clears on the next poll, the confirmation must stay readable. */}
    {resetState === "done" && !snapshot && <M3Banner tone="success" title="已重置实时凭据">设备会在 30 秒内重新登记并连接。</M3Banner>}
    {failure && !fresh && !conflictAt && <M3Banner tone="warning" title={failure.title}>{failure.detail}</M3Banner>}
    {failure && fresh && <p className="workspace-live__stale-note">{failure.detail}</p>}
    {fresh && topic === "metrics" && <LiveMetrics data={snapshot.data as LiveMetricsData} samples={samples} />}
    {fresh && topic === "processes" && <ProcessTable data={snapshot.data as LiveProcesses} />}
    {fresh && topic === "docker" && <DockerTable data={snapshot.data as LiveDocker} rates={rates} />}
  </div>;
}

/**
 * Whether the numbers below are current, and the two controls that change
 * that. The visible label ticks every second; only the tone is announced, so a
 * screen reader hears "实时" once rather than an age every second.
 */
function LiveStatusBar({ tone, label, detail, paused, onPausedChange, interval, onIntervalChange }: { tone: LiveStatusTone; label: string; detail: string | null; paused: boolean; onPausedChange: (paused: boolean) => void; interval: number; onIntervalChange: (seconds: number) => void }) {
  return <div className="workspace-live__status">
    <span className={`workspace-live__pill workspace-live__pill--${tone}`}><span className="workspace-live__pulse" aria-hidden="true" /><span aria-hidden="true">{label}</span></span>
    <span className="workspace-visually-hidden" role="status">{toneNames[tone]}</span>
    {detail && <span className="workspace-live__status-detail">{detail}</span>}
    <span className="workspace-live__status-actions">
      <Button variant="quiet" onClick={() => onPausedChange(!paused)}><Icon name={paused ? "play" : "pause"} size={16} />{paused ? "继续" : "暂停"}</Button>
      <M3Select label="刷新频率" hideLabel className="workspace-live__interval" value={String(interval)} onChange={(event) => onIntervalChange(Number(event.target.value))} options={intervalOptions} />
    </span>
  </div>;
}

const toneNames: Record<LiveStatusTone, string> = { connecting: "正在连接设备", live: "实时数据", stale: "结果未更新", paused: "已暂停", unavailable: "实时数据不可用" };

/** Measurement caveats are reference material: one click away, never in front of the numbers. */
function LiveNote({ children }: { children: React.ReactNode }) {
  return <details className="workspace-live__note"><summary><Icon name="info" size={15} />口径说明</summary><div>{children}</div></details>;
}

const LIVE_WINDOW_MS = 120_000;
const LIVE_SAMPLE_LIMIT = 150;
interface LiveSample { at: number; data: LiveMetricsData }

function liveSeries(samples: LiveSample[], label: string, pick: (data: LiveMetricsData) => number | null, valueFormatter: (value: number) => string): ChartSeries {
  const points: SamplePoint[] = [];
  for (const sample of samples) {
    const value = pick(sample.data);
    if (value !== null && Number.isFinite(value)) points.push({ timestamp: new Date(sample.at).toISOString(), value });
  }
  return { label, points, valueFormatter };
}

const percent = (value: number) => `${value.toFixed(1)}%`;
const rate = (value: number) => `${formatBytes(value)}/s`;
const memoryPercent = (data: LiveMetricsData) => data.memoryUsedBytes !== null && data.memoryTotalBytes ? data.memoryUsedBytes / data.memoryTotalBytes * 100 : null;

/**
 * The same four questions the history overview answers (CPU, memory, disk,
 * network), on the same card, so switching the range to 实时 changes the
 * time scale and nothing else the reader has to re-learn.
 */
function LiveMetrics({ data, samples }: { data: LiveMetricsData; samples: LiveSample[] }) {
  const memory = data.memoryUsedBytes !== null && data.memoryTotalBytes !== null ? `${formatBytes(data.memoryUsedBytes)} / ${formatBytes(data.memoryTotalBytes)}` : "容量不可用";
  return <>
    <DashboardGrid>
      <DashboardCell span="half"><LiveTrendTile title="CPU 使用率" subtitle="整机平均" maxValue={100} series={[liveSeries(samples, "CPU", (item) => item.cpuPercent, percent)]} /></DashboardCell>
      <DashboardCell span="half"><LiveTrendTile title="内存占用" subtitle={memory} maxValue={100} series={[liveSeries(samples, "已用内存", memoryPercent, percent)]} /></DashboardCell>
      <DashboardCell span="half"><LiveTrendTile title="磁盘读写" subtitle="所有磁盘合计" series={[liveSeries(samples, "读取", (item) => item.diskReadBytesPerSec, rate), liveSeries(samples, "写入", (item) => item.diskWriteBytesPerSec, rate)]} /></DashboardCell>
      <DashboardCell span="half"><LiveTrendTile title="网络收发" subtitle="所有网卡合计" series={[liveSeries(samples, "接收", (item) => item.networkRxBytesPerSec, rate), liveSeries(samples, "发送", (item) => item.networkTxBytesPerSec, rate)]} /></DashboardCell>
    </DashboardGrid>
    <LiveNote>只保留最近两分钟，不写入历史；快速指标与历史上报使用各自的采样窗口，查看不会改变历史数据。数值第一次出现前需要一个完整的采样窗口。温度、风扇、GPU 与硬件信息只在历史范围中按原有频率采集。</LiveNote>
  </>;
}

function LiveTrendTile({ title, subtitle, series, maxValue }: { title: string; subtitle: string; series: ChartSeries[]; maxValue?: number }) {
  const [hovered, setHovered] = useState<ChartInspection | null>(null);
  const readoutId = useId();
  const formatter = series[0]?.valueFormatter;
  const latest = useMemo(() => latestChartValues(series, indexChartSamples(series), formatter), [series, formatter]);
  const empty = !series.some((item) => item.points.length);
  return <ChartTile
    title={title}
    subtitle={subtitle}
    readout={<ChartReadout info={hovered ?? latest} inspecting={Boolean(hovered)} id={readoutId} compact />}
    emptyMessage={empty ? "等待第一个有效采样" : undefined}
  >
    <TimeSeriesChart series={series} visualization="line" maxValue={maxValue} valueFormatter={formatter} onHoverPoint={setHovered} hideReadout readoutId={readoutId} ariaLabel={`${title}，最近两分钟`} />
  </ChartTile>;
}

function ProcessTable({ data }: { data: LiveProcesses }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("cpu");
  const [page, setPage] = useState(0);
  const items = useMemo(() => data.items.filter((item) => `${item.name} ${item.pid}`.toLowerCase().includes(query.toLowerCase())).sort((left, right) => sort === "memory" ? (right.memoryBytes ?? -1) - (left.memoryBytes ?? -1) : sort === "pid" ? left.pid - right.pid : (right.cpuPercent ?? -1) - (left.cpuPercent ?? -1)), [data, query, sort]);
  const current = Math.min(page, Math.max(0, Math.ceil(items.length / 50) - 1));
  return <>
    <div className="workspace-live__toolbar">
      <label>搜索进程<input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="名称或 PID" /></label>
      <M3Select label="排序" value={sort} onChange={(event) => { setSort(event.target.value); setPage(0); }} options={[{ value: "cpu", label: "CPU" }, { value: "memory", label: "内存" }, { value: "pid", label: "PID" }]} />
      <span className="workspace-live__summary">系统共 {data.totalCount} 个进程，读取到 {data.items.length} 个{data.truncated ? "（已达采集上限）" : ""}</span>
    </div>
    <div className="workspace-live__table"><table><thead><tr><th>进程</th><th>PID / 父 PID</th><th>CPU</th><th>内存</th><th>线程</th><th>状态</th></tr></thead><tbody>{items.slice(current * 50, current * 50 + 50).map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.pid} / {item.parentPid ?? "—"}</td><td>{item.cpuPercent === null ? "—" : `${item.cpuPercent.toFixed(1)}%`}</td><td>{item.memoryBytes === null ? "—" : formatBytes(item.memoryBytes)}</td><td>{item.threads ?? "—"}</td><td>{item.status ?? "—"}</td></tr>)}</tbody></table></div>
    {!items.length && <p>本次快照中没有可显示的匹配进程。</p>}
    <div className="workspace-live__toolbar"><Button variant="quiet" disabled={current === 0} onClick={() => setPage(current - 1)}>上一页</Button><span>{current + 1} / {Math.max(1, Math.ceil(items.length / 50))} 页</span><Button variant="quiet" disabled={(current + 1) * 50 >= items.length} onClick={() => setPage(current + 1)}>下一页</Button></div>
    <LiveNote>“—”表示没有读到，不是零：受保护或采集中退出的进程可能无法读取。CPU 按整机容量归一化（满载为 100%），内存为 RSS / 工作集。</LiveNote>
  </>;
}

function DockerTable({ data, rates }: { data: LiveDocker; rates: Map<string, ContainerRates> }) {
  const pair = (first: number | null | undefined, second: number | null | undefined) => `${first === null || first === undefined ? "—" : `${formatBytes(first)}/s`} / ${second === null || second === undefined ? "—" : `${formatBytes(second)}/s`}`;
  const coverage = data.statsCandidates !== undefined && data.statsRead !== undefined ? ` · 资源统计 ${data.statsRead} / ${data.statsCandidates}` : "";
  return <>
    <p className="workspace-live__summary">Engine {data.engineId} · {data.totalCount} 个容器{data.truncated ? "（已达 512 个上限）" : ""}{coverage}</p>
    <div className="workspace-live__table"><table><thead><tr><th>容器 / 镜像</th><th>状态</th><th>Compose 项目</th><th>CPU</th><th>内存 / 限额</th><th>网络收 / 发</th><th>块设备读 / 写</th></tr></thead><tbody>{data.items.map((item) => {
      const rate = rates.get(item.id);
      return <tr key={item.id}><td>{item.name}<small>{item.image}</small></td><td>{item.state}<small>{item.status}</small></td><td>{item.project ?? "—"}</td><td>{item.cpuPercent === null ? "—" : `${item.cpuPercent.toFixed(1)}%`}</td><td>{item.memoryBytes === null ? "—" : formatBytes(item.memoryBytes)} / {item.memoryLimitBytes === null ? "—" : formatBytes(item.memoryLimitBytes)}</td><td title={item.networkRxBytes === null ? undefined : `累计 ${formatBytes(item.networkRxBytes)} / ${item.networkTxBytes === null ? "—" : formatBytes(item.networkTxBytes)}`}>{pair(rate?.networkRx, rate?.networkTx)}</td><td>{pair(rate?.blockRead, rate?.blockWrite)}</td></tr>;
    })}</tbody></table></div>
    {!data.items.length && <p>已连接 Docker Engine，本次查询确实没有容器。</p>}
    <LiveNote>
      <p>“—”表示没有取到。Docker CPU 按单核计数，可超过 100%。网络与块设备是相邻两次查询之间的速率，所以第一次查询总是“—”。</p>
      <p>{data.statsCandidates !== undefined ? "每次最多为 32 个运行中容器读取资源统计，优先最忙的并轮换其余；内存与 docker stats 口径一致，不含可回收的文件缓存。" : "每次最多为 32 个运行中容器读取资源统计；内存是 Engine 原始使用量，升级设备端后与 docker stats 口径一致。"}</p>
    </LiveNote>
  </>;
}
