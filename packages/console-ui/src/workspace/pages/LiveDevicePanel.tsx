import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ConsoleLivePort, LiveDocker, LiveMetrics as LiveMetricsData, LiveProcesses, LiveSnapshot, LiveTopic } from "@dsc/shared";
import { startVisiblePolling } from "../../helpers/visiblePolling";
import { useLivePort } from "../WorkspaceContext";
import { formatBytes, formatDate } from "../formatters";
import { M3Banner, M3Tabs, M3Select } from "../m3";
import { Button, Icon } from "../ui";
import { acceptsLiveSnapshot, containerRates, describeLiveError, isDisconnectedLiveError, isTransientLiveError, liveStatus, percentPath, type ContainerRates, type LiveFailure, type LiveStatusTone } from "../livePresentation";
import "./live.css";

export function LiveDevicePanel({ deviceId, authenticated }: { deviceId: string; authenticated: boolean }) {
  const port = useLivePort();
  const [open, setOpen] = useState(false);
  return <details className="workspace-live" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>实时查看 · 高频指标 / 进程 / Docker</summary>
    <p className="workspace-live__lead">展开时才向设备查询，结果不写入历史；下方图表仍是历史上报数据。</p>
    {!port ? <p>当前客户端尚不支持实时查看。</p> : !authenticated ? <p>请先连接并登录中枢，离线缓存不能提供实时能力。</p> : open ? <LiveView key={deviceId} deviceId={deviceId} port={port} /> : null}
  </details>;
}

const intervalOptions = [{ value: "1", label: "每 1 秒" }, { value: "2", label: "每 2 秒" }, { value: "5", label: "每 5 秒" }];

function LiveView({ deviceId, port }: { deviceId: string; port: ConsoleLivePort }) {
  const [topic, setTopic] = useState<LiveTopic>("metrics");
  const [interval, setIntervalSeconds] = useState(1);
  const [paused, setPaused] = useState(false);
  return <>
    <M3Tabs aria-label="实时查看内容" value={topic} onChange={(id) => setTopic(id as LiveTopic)} tabs={[{ id: "metrics", label: "高频指标" }, { id: "processes", label: "进程" }, { id: "docker", label: "Docker" }]} />
    {/* The interval is not part of the key: changing it must not discard the two-minute curve. */}
    <LiveTopicView key={`${deviceId}:${topic}`} deviceId={deviceId} port={port} topic={topic} interval={interval} onIntervalChange={setIntervalSeconds} paused={paused} onPausedChange={setPaused} />
  </>;
}

function LiveTopicView({ deviceId, port, topic, interval, onIntervalChange, paused, onPausedChange }: { deviceId: string; port: ConsoleLivePort; topic: LiveTopic; interval: number; onIntervalChange: (seconds: number) => void; paused: boolean; onPausedChange: (paused: boolean) => void }) {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [failure, setFailure] = useState<LiveFailure | null>(null);
  const [now, setNow] = useState(Date.now());
  const [lastConfirmed, setLastConfirmed] = useState(0);
  const [conflictAt, setConflictAt] = useState<string | null>(null);
  const [resetState, setResetState] = useState<"idle" | "pending" | "done" | "failed">("idle");
  const [points, setPoints] = useState<Array<{ at: number; cpu: number | null; memory: number | null }>>([]);
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
    const gap = (at: number) => setPoints((previous) => [...previous.filter((point) => point.at >= at - 120_000), { at, cpu: null, memory: null }].slice(-120));
    // A pause or interval change must not draw a line across the time nobody asked.
    gap(Date.now());
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
          const metrics = result.data as LiveMetricsData;
          const cpu = metrics.cpuPercent;
          const memory = metrics.memoryUsedBytes !== null && metrics.memoryTotalBytes ? metrics.memoryUsedBytes / metrics.memoryTotalBytes * 100 : null;
          setPoints((previous) => [...(changedSession ? [] : previous.filter((point) => point.at >= at - 120_000)), { at, cpu, memory }].slice(-120));
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
        gap(Date.now());
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
    {fresh && topic === "metrics" && <LiveMetrics data={snapshot.data as LiveMetricsData} points={points} now={now} />}
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

function LiveMetrics({ data, points, now }: { data: LiveMetricsData; points: Array<{ at: number; cpu: number | null; memory: number | null }>; now: number }) {
  const rate = (value: number | null) => value === null ? "待有效采样" : `${formatBytes(value)}/s`;
  const values = [
    ["CPU", data.cpuPercent === null ? "待有效采样" : `${data.cpuPercent.toFixed(1)}%`],
    ["内存", data.memoryUsedBytes === null || data.memoryTotalBytes === null ? "不可用" : `${formatBytes(data.memoryUsedBytes)} / ${formatBytes(data.memoryTotalBytes)}`],
    ["磁盘读取", rate(data.diskReadBytesPerSec)],
    ["磁盘写入", rate(data.diskWriteBytesPerSec)],
    ["网络接收", rate(data.networkRxBytesPerSec)],
    ["网络发送", rate(data.networkTxBytesPerSec)]
  ];
  return <>
    <div className="workspace-live__metrics">{values.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    <div className="workspace-live__charts">{(["cpu", "memory"] as const).map((key) => <figure key={key}><figcaption>{key === "cpu" ? "CPU" : "内存"} · 最近两分钟 · 0–100%</figcaption><svg viewBox="0 0 600 80" role="img" aria-label={`${key === "cpu" ? "CPU" : "内存"}实时趋势`}><path d={percentPath(points.map((point) => ({ at: point.at, value: point[key] })), now)} fill="none" stroke="currentColor" strokeWidth="2" /></svg></figure>)}</div>
    <LiveNote>快速指标与历史上报使用各自的采样窗口，查看不会改变历史数据。温度、风扇、GPU 与硬件信息只在历史图表中按原有频率采集。</LiveNote>
  </>;
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
