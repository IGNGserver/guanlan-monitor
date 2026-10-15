import React, { useEffect, useMemo, useRef, useState } from "react";
import type { AgentMetricsPayload, ConsoleLivePort, LiveDocker, LiveProcesses, LiveSnapshot, LiveTopic } from "@dsc/shared";
import { startVisiblePolling } from "../../helpers/visiblePolling";
import { useLivePort } from "../WorkspaceContext";
import { formatBytes, formatDate } from "../formatters";
import { M3Tabs, M3Select } from "../m3";
import { Button } from "../ui";
import { acceptsLiveSnapshot, liveErrorMessage, percentPath } from "../livePresentation";
import "./live.css";

export function LiveDevicePanel({ deviceId, authenticated }: { deviceId: string; authenticated: boolean }) {
  const port = useLivePort();
  const [open, setOpen] = useState(false);
  return <details className="workspace-live" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>实时查看 · 高频指标 / 进程 / Docker</summary>
    <p>仅在展开且页面可见时查询真实设备，不读取历史缓存。下方原有图表仍为历史上报数据。</p>
    {!port ? <p>当前客户端尚不支持实时查看。</p> : !authenticated ? <p>请先连接并登录中枢，离线缓存不能提供实时能力。</p> : open ? <LiveView key={deviceId} deviceId={deviceId} port={port} /> : null}
  </details>;
}

function LiveView({ deviceId, port }: { deviceId: string; port: ConsoleLivePort }) {
  const [topic, setTopic] = useState<LiveTopic>("metrics");
  const [interval, setIntervalSeconds] = useState(1);
  return <>
    <div className="workspace-live__toolbar">
      <M3Tabs aria-label="实时查看内容" value={topic} onChange={(id) => setTopic(id as LiveTopic)} tabs={[{ id: "metrics", label: "高频指标" }, { id: "processes", label: "进程" }, { id: "docker", label: "Docker" }]} />
      <M3Select label="查询间隔" value={String(interval)} onChange={(event) => setIntervalSeconds(Number(event.target.value))} options={[{ value: "1", label: "1 秒" }, { value: "2", label: "2 秒" }, { value: "5", label: "5 秒" }]} />
    </div>
    <LiveTopicView key={`${deviceId}:${topic}:${interval}`} deviceId={deviceId} port={port} topic={topic} interval={interval} />
  </>;
}

function LiveTopicView({ deviceId, port, topic, interval }: { deviceId: string; port: ConsoleLivePort; topic: LiveTopic; interval: number }) {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [lastConfirmed, setLastConfirmed] = useState(0);
  const [points, setPoints] = useState<Array<{ at: number; cpu: number | null; memory: number | null }>>([]);
  const session = useRef<string | null>(null);
  useEffect(() => {
    let stopped = false;
    const stop = startVisiblePolling(async () => {
      try {
        const started = performance.now();
        const connection = await port.getLiveConnection(deviceId);
        if (stopped) return;
        if (connection.state !== "ready") throw new Error("device_not_connected");
        if (!connection.capabilities.includes(topic)) throw new Error("device_capability_unavailable");
        const result = await port.readLive(deviceId, topic);
        if (stopped) return;
        if (performance.now() - started > 6000) throw new Error("query_expired");
        if (!acceptsLiveSnapshot(connection, result, deviceId, topic)) throw new Error("device_disconnected");
        const at = Date.now();
        const changedSession = session.current !== result.sessionId;
        session.current = result.sessionId;
        setSnapshot(result); setLastConfirmed(at); setNow(at); setError(null);
        if (topic === "metrics") {
          const metrics = result.data as AgentMetricsPayload;
          const cpu = metrics.unavailableMetrics?.includes("cpuUsage") ? null : metrics.cpuUsagePercent;
          const memory = !metrics.unavailableMetrics?.includes("memoryUsage") && metrics.memory.totalBytes > 0 ? metrics.memory.usedBytes / metrics.memory.totalBytes * 100 : null;
          setPoints((previous) => [...(changedSession ? [] : previous.filter((point) => point.at >= at - 120_000)), { at, cpu, memory }].slice(-120));
        }
      } catch (nextError) {
        if (stopped) return;
        setSnapshot(null); setError(liveErrorMessage(nextError));
        const at = Date.now();
        setPoints((previous) => [...previous.filter((point) => point.at >= at - 120_000), { at, cpu: null, memory: null }].slice(-120));
      }
    }, interval * 1000, true);
    const stopClock = startVisiblePolling(async () => { setNow(Date.now()); }, 1000);
    return () => { stopped = true; stop(); stopClock(); };
  }, [deviceId, interval, port, topic]);
  const expired = lastConfirmed > 0 && now - lastConfirmed > Math.max(6000, interval * 2000);
  const fresh = snapshot !== null && !expired && !error;
  return <div>
    <p role="status">{error ?? (expired ? "上次结果已过期，正在等待设备重新确认。" : snapshot ? `设备已确认返回 · ${formatDate(snapshot.receivedAt)} · ${Math.max(0, Math.floor((now - lastConfirmed) / 1000))} 秒前` : "正在确认设备连接并请求采集……")}</p>
    {fresh && topic === "metrics" && <LiveMetrics data={snapshot.data as AgentMetricsPayload} points={points} now={now} />}
    {fresh && topic === "processes" && <ProcessTable data={snapshot.data as LiveProcesses} />}
    {fresh && topic === "docker" && <DockerTable data={snapshot.data as LiveDocker} />}
  </div>;
}

function LiveMetrics({ data, points, now }: { data: AgentMetricsPayload; points: Array<{ at: number; cpu: number | null; memory: number | null }>; now: number }) {
  const values = [
    ["CPU", data.unavailableMetrics?.includes("cpuUsage") ? "待有效采样" : `${data.cpuUsagePercent.toFixed(1)}%`],
    ["内存", data.unavailableMetrics?.includes("memoryUsage") || data.memory.totalBytes <= 0 ? "不可用" : formatBytes(data.memory.usedBytes)],
    ["磁盘读取", data.unavailableMetrics?.includes("diskRead") ? "不可用" : `${formatBytes(data.diskRate.readBytesPerSec)}/s`],
    ["磁盘写入", data.unavailableMetrics?.includes("diskWrite") ? "不可用" : `${formatBytes(data.diskRate.writeBytesPerSec)}/s`],
    ["网络接收", data.unavailableMetrics?.includes("networkRxRate") ? "不可用" : `${formatBytes(data.networkRate.rxBytesPerSec)}/s`],
    ["网络发送", data.unavailableMetrics?.includes("networkTxRate") ? "不可用" : `${formatBytes(data.networkRate.txBytesPerSec)}/s`]
  ];
  return <>
    <div className="workspace-live__metrics">{values.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    <div className="workspace-live__charts">{(["cpu", "memory"] as const).map((key) => <figure key={key}><figcaption>{key === "cpu" ? "CPU" : "内存"} · 最近两分钟 · 0–100%</figcaption><svg viewBox="0 0 600 80" role="img" aria-label={`${key === "cpu" ? "CPU" : "内存"}实时趋势`}><path d={percentPath(points.map((point) => ({ at: point.at, value: point[key] })), now)} fill="none" stroke="currentColor" strokeWidth="2" /></svg></figure>)}</div>
    <p>快速指标采集于 {formatDate(data.timestamp)}。温度、风扇、GPU 与硬件信息保留各自采集频率，不因页面每秒查询而伪装成新样本。</p>
    <p>硬件最近采集：{formatDate(data.hardwareSampledAt ?? null)}；CPU 温度：{formatDate(data.cpuTemperatureSampledAt ?? null)}</p>
    <details><summary>全部指标与采集时间</summary><pre className="workspace-live__raw">{JSON.stringify(data, null, 2)}</pre></details>
  </>;
}

function ProcessTable({ data }: { data: LiveProcesses }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("cpu");
  const [page, setPage] = useState(0);
  const items = useMemo(() => data.items.filter((item) => `${item.name} ${item.pid}`.toLowerCase().includes(query.toLowerCase())).sort((left, right) => sort === "memory" ? (right.memoryBytes ?? -1) - (left.memoryBytes ?? -1) : sort === "pid" ? left.pid - right.pid : (right.cpuPercent ?? -1) - (left.cpuPercent ?? -1)), [data, query, sort]);
  const current = Math.min(page, Math.max(0, Math.ceil(items.length / 50) - 1));
  return <>
    <p>采集于 {formatDate(data.observedAt)}。系统枚举 {data.totalCount} 个进程，成功读取 {data.items.length} 个{data.truncated ? "（已达到 4096 个采集上限）" : ""}。受保护或采集中退出的进程可能无法读取；“—”不是零。CPU 按整机容量归一化，内存为 RSS / 工作集。</p>
    <div className="workspace-live__toolbar"><label>搜索进程<input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="名称或 PID" /></label><M3Select label="排序" value={sort} onChange={(event) => { setSort(event.target.value); setPage(0); }} options={[{ value: "cpu", label: "CPU" }, { value: "memory", label: "内存" }, { value: "pid", label: "PID" }]} /></div>
    <div className="workspace-live__table"><table><thead><tr><th>进程</th><th>PID / 父 PID</th><th>CPU</th><th>内存</th><th>线程</th><th>状态</th></tr></thead><tbody>{items.slice(current * 50, current * 50 + 50).map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.pid} / {item.parentPid ?? "—"}</td><td>{item.cpuPercent === null ? "—" : `${item.cpuPercent.toFixed(1)}%`}</td><td>{item.memoryBytes === null ? "—" : formatBytes(item.memoryBytes)}</td><td>{item.threads ?? "—"}</td><td>{item.status ?? "—"}</td></tr>)}</tbody></table></div>
    {!items.length && <p>本次快照中没有可显示的匹配进程。</p>}
    <div className="workspace-live__toolbar"><Button variant="quiet" disabled={current === 0} onClick={() => setPage(current - 1)}>上一页</Button><span>{current + 1} / {Math.max(1, Math.ceil(items.length / 50))} 页</span><Button variant="quiet" disabled={(current + 1) * 50 >= items.length} onClick={() => setPage(current + 1)}>下一页</Button></div>
  </>;
}

function DockerTable({ data }: { data: LiveDocker }) {
  return <>
    <p>采集于 {formatDate(data.observedAt)}。Engine {data.engineId} · {data.totalCount} 个容器{data.truncated ? "（列表达到 512 个上限）" : ""}。资源统计每次最多读取 32 个运行中容器，“—”表示未取得；Docker CPU 按单核计数，可超过 100%。内存是 Engine 原始使用量。</p>
    <div className="workspace-live__table"><table><thead><tr><th>容器 / 镜像</th><th>状态</th><th>Compose 项目</th><th>CPU</th><th>内存 / 限额</th><th>网络收 / 发累计</th></tr></thead><tbody>{data.items.map((item) => <tr key={item.id}><td>{item.name}<small>{item.image}</small></td><td>{item.state}<small>{item.status}</small></td><td>{item.project ?? "—"}</td><td>{item.cpuPercent === null ? "—" : `${item.cpuPercent.toFixed(1)}%`}</td><td>{item.memoryBytes === null ? "—" : formatBytes(item.memoryBytes)} / {item.memoryLimitBytes === null ? "—" : formatBytes(item.memoryLimitBytes)}</td><td>{item.networkRxBytes === null ? "—" : formatBytes(item.networkRxBytes)} / {item.networkTxBytes === null ? "—" : formatBytes(item.networkTxBytes)}</td></tr>)}</tbody></table></div>
    {!data.items.length && <p>已连接 Docker Engine，本次查询确实没有容器。</p>}
  </>;
}
