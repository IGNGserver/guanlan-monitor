import React, { useMemo, useRef, useState } from "react";
import type { LiveContainer, LiveDocker, LiveProcess, LiveProcesses } from "@dsc/shared";
import { formatBytes, formatDate } from "../formatters";
import { M3Chip, M3SearchBar } from "../m3";
import { Button, Icon } from "../ui";
import { containerHealth, containerStateLabel, groupContainers, holdOrder, sortProcesses, type ContainerHealth, type ContainerRates, type ProcessSortKey } from "../livePresentation";

/** Measurement caveats are reference material: one click away, never in front of the numbers. */
export function LiveNote({ children }: { children: React.ReactNode }) {
  return <details className="workspace-live__note"><summary><Icon name="info" size={15} />口径说明</summary><div>{children}</div></details>;
}

const PAGE = 100;
/** How long a new sort order waits before it replaces the one on screen. */
const REORDER_MS = 5_000;

function SortHeader({ label, sortKey, sort, onSort, numeric = false, info }: { label: string; sortKey: ProcessSortKey; sort: { key: ProcessSortKey; descending: boolean }; onSort: (key: ProcessSortKey) => void; numeric?: boolean; info?: string }) {
  const active = sort.key === sortKey;
  return <th scope="col" data-align={numeric ? "end" : undefined} aria-sort={active ? (sort.descending ? "descending" : "ascending") : "none"}>
    <button type="button" className={`live-table__sort${active ? " is-active" : ""}`} onClick={() => onSort(sortKey)}>
      {label}
      <span className="live-table__sort-mark" aria-hidden="true">{active ? (sort.descending ? "↓" : "↑") : "↕"}</span>
    </button>
    {info ? <span className="live-table__info" title={info}><Icon name="info" size={13} /><span className="workspace-visually-hidden">{info}</span></span> : null}
  </th>;
}

/** A value with a thin bar under it; nothing is drawn for a value that was not read. */
function BarValue({ text, ratio }: { text: string; ratio: number | null }) {
  return <span className="live-table__bar-value">
    {text}
    {ratio !== null ? <span className="live-table__bar" aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%` }} /></span> : null}
  </span>;
}

export function ProcessTable({ data }: { data: LiveProcesses }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: ProcessSortKey; descending: boolean }>({ key: "cpu", descending: true });
  const [limit, setLimit] = useState(PAGE);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pointerInside, setPointerInside] = useState(false);
  const order = useRef<{ ids: string[]; at: number; signature: string }>({ ids: [], at: 0, signature: "" });
  const needle = query.trim().toLowerCase();
  const matching = useMemo(() => data.items.filter((item) => `${item.name} ${item.pid}`.toLowerCase().includes(needle)), [data, needle]);
  const sorted = useMemo(() => sortProcesses(matching, sort.key, sort.descending), [matching, sort]);
  const signature = `${sort.key}:${sort.descending}:${needle}`;
  // Values refresh every tick; positions only when nobody is reading the rows
  // and the last reorder is old enough. A new sort or search applies at once.
  const holding = (pointerInside || expanded !== null) && order.current.signature === signature;
  const now = Date.now();
  if (!holding && (order.current.signature !== signature || now - order.current.at >= REORDER_MS)) {
    order.current = { ids: sorted.map((item) => item.id), at: now, signature };
  } else {
    order.current = { ...order.current, ids: holdOrder(order.current.ids, sorted.map((item) => item.id)) };
  }
  const byId = new Map(matching.map((item) => [item.id, item]));
  const rows = order.current.ids.map((id) => byId.get(id)).filter((item): item is LiveProcess => item !== undefined);
  const maxMemory = Math.max(0, ...data.items.map((item) => item.memoryBytes ?? 0));
  const changeSort = (key: ProcessSortKey) => setSort((current) => current.key === key ? { key, descending: !current.descending } : { key, descending: key !== "name" && key !== "pid" });
  return <>
    <div className="workspace-live__toolbar">
      <M3SearchBar className="workspace-live__search" label="搜索进程" placeholder="搜索名称或 PID" value={query} onChange={(event) => { setQuery(event.target.value); setLimit(PAGE); }} onClear={() => setQuery("")} />
      <span className="workspace-live__summary">
        系统共 {data.totalCount} 个进程，读取到 {data.items.length} 个{data.truncated ? "（已达采集上限）" : ""}
        {needle ? ` · 匹配 ${matching.length} 个` : ""}
        {holding ? " · 顺序已固定" : ""}
      </span>
    </div>
    {/* Hovering the table holds the order so a row cannot move under the pointer. */}
    <div className="workspace-live__table" onPointerEnter={() => setPointerInside(true)} onPointerLeave={() => setPointerInside(false)}>
      <table className="live-table" aria-label="进程">
        <thead><tr>
          <SortHeader label="进程" sortKey="name" sort={sort} onSort={changeSort} />
          <SortHeader label="PID" sortKey="pid" sort={sort} onSort={changeSort} numeric />
          <SortHeader label="CPU" sortKey="cpu" sort={sort} onSort={changeSort} numeric info="按整机容量归一化，满载为 100%" />
          <SortHeader label="内存" sortKey="memory" sort={sort} onSort={changeSort} numeric info="RSS / 工作集；横条相对本次列表中占用最多的进程" />
          <SortHeader label="线程" sortKey="threads" sort={sort} onSort={changeSort} numeric />
        </tr></thead>
        <tbody>{rows.slice(0, limit).map((item) => {
          const open = expanded === item.id;
          return <React.Fragment key={item.id}>
            <tr className={open ? "is-expanded" : undefined}>
              <td><button type="button" className="live-table__expand" aria-expanded={open} onClick={() => setExpanded(open ? null : item.id)}><Icon name={open ? "chevron" : "chevronRight"} size={14} /><span>{item.name}</span></button></td>
              <td data-align="end" className="live-table__mono">{item.pid}</td>
              <td data-align="end">{item.cpuPercent === null ? "—" : <BarValue text={`${item.cpuPercent.toFixed(1)}%`} ratio={item.cpuPercent / 100} />}</td>
              <td data-align="end">{item.memoryBytes === null ? "—" : <BarValue text={formatBytes(item.memoryBytes)} ratio={maxMemory ? item.memoryBytes / maxMemory : null} />}</td>
              <td data-align="end">{item.threads ?? "—"}</td>
            </tr>
            {open && <tr className="live-table__detail"><td colSpan={5}>
              <dl>
                <div><dt>父进程 PID</dt><dd className="live-table__mono">{item.parentPid ?? "—"}</dd></div>
                <div><dt>状态</dt><dd>{item.status ?? "—"}</dd></div>
                <div><dt>启动时间</dt><dd>{item.startedAt ? formatDate(item.startedAt) : "—"}</dd></div>
              </dl>
            </td></tr>}
          </React.Fragment>;
        })}</tbody>
      </table>
    </div>
    {!rows.length && <p className="workspace-live__empty">{needle ? `没有名称或 PID 包含“${query.trim()}”的进程。` : "本次快照中没有可显示的进程。"}</p>}
    {rows.length > limit && <div className="workspace-live__more"><Button variant="quiet" onClick={() => setLimit(limit + PAGE)}>再显示 {Math.min(PAGE, rows.length - limit)} 个</Button><span>已显示 {limit} / {rows.length}</span></div>}
    <LiveNote>“—”表示没有读到，不是零：受保护或采集中退出的进程可能无法读取。CPU 按整机容量归一化（满载为 100%），内存为 RSS / 工作集。鼠标停在表格上或展开某一行时，行的顺序保持不动；否则最多每 5 秒按排序重新排列一次。</LiveNote>
  </>;
}

const healthFilters: Array<{ id: ContainerHealth; label: string }> = [
  { id: "running", label: "运行中" },
  { id: "problem", label: "需要关注" },
  { id: "stopped", label: "未运行" }
];

const rateText = (value: number | null | undefined) => value === null || value === undefined ? "—" : `${formatBytes(value)}/s`;

function ContainerRow({ item, rate }: { item: LiveContainer; rate: ContainerRates | undefined }) {
  const health = containerHealth(item);
  return <tr>
    <td><span className="live-table__name">{item.name}</span><small className="live-table__mono" title={item.image}>{item.image}</small></td>
    <td><span className={`live-chip live-chip--${health}`}>{containerStateLabel(item)}</span><small title={item.status}>{item.status}</small></td>
    <td data-align="end">{item.cpuPercent === null ? "—" : <BarValue text={`${item.cpuPercent.toFixed(1)}%`} ratio={item.cpuPercent / 100} />}</td>
    <td data-align="end">{item.memoryBytes === null ? "—" : <BarValue text={formatBytes(item.memoryBytes)} ratio={item.memoryLimitBytes ? item.memoryBytes / item.memoryLimitBytes : null} />}<small>{item.memoryLimitBytes === null ? "无限额" : `限额 ${formatBytes(item.memoryLimitBytes)}`}</small></td>
    <td data-align="end" className="live-table__io" title={item.networkRxBytes === null ? undefined : `累计接收 ${formatBytes(item.networkRxBytes)} / 发送 ${item.networkTxBytes === null ? "—" : formatBytes(item.networkTxBytes)}`}>
      <span>网络 ↓ {rateText(rate?.networkRx)} ↑ {rateText(rate?.networkTx)}</span>
      <small>磁盘 读 {rateText(rate?.blockRead)} 写 {rateText(rate?.blockWrite)}</small>
    </td>
  </tr>;
}

export function DockerTable({ data, rates }: { data: LiveDocker; rates: Map<string, ContainerRates> }) {
  const [filter, setFilter] = useState<ContainerHealth | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const counts = useMemo(() => {
    const result: Record<ContainerHealth, number> = { running: 0, problem: 0, stopped: 0 };
    for (const item of data.items) result[containerHealth(item)]++;
    return result;
  }, [data]);
  const visible = filter ? data.items.filter((item) => containerHealth(item) === filter) : data.items;
  const groups = groupContainers(visible);
  const grouped = groups.some((group) => group.project !== null);
  const toggle = (key: string) => setCollapsed((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const coverage = data.statsCandidates !== undefined && data.statsRead !== undefined ? ` · 已读取 ${data.statsRead} / ${data.statsCandidates} 个运行中容器的资源` : "";
  return <>
    <div className="workspace-live__toolbar">
      <div className="workspace-live__filters" role="group" aria-label="按状态筛选容器">
        <M3Chip selected={filter === null} onClick={() => setFilter(null)}>全部 {data.items.length}</M3Chip>
        {healthFilters.map((option) => <M3Chip key={option.id} className={`live-filter live-filter--${option.id}`} selected={filter === option.id} onClick={() => setFilter(filter === option.id ? null : option.id)}>{option.label} {counts[option.id]}</M3Chip>)}
      </div>
      <span className="workspace-live__summary">Engine {data.engineId}{data.truncated ? " · 已达 512 个上限" : ""}{coverage}</span>
    </div>
    {visible.length > 0 && <div className="workspace-live__table">
      <table className="live-table" aria-label="容器">
        <thead><tr>
          <th scope="col">容器</th>
          <th scope="col">状态</th>
          <th scope="col" data-align="end">CPU <span className="live-table__info" title="按单核计数，多核满载可超过 100%"><Icon name="info" size={13} /><span className="workspace-visually-hidden">按单核计数，多核满载可超过 100%</span></span></th>
          <th scope="col" data-align="end">内存</th>
          <th scope="col" data-align="end">I/O <span className="live-table__info" title="相邻两次查询之间的速率，第一次查询为“—”"><Icon name="info" size={13} /><span className="workspace-visually-hidden">相邻两次查询之间的速率，第一次查询为“—”</span></span></th>
        </tr></thead>
        {groups.map((group) => {
          const key = group.project ?? "";
          const open = !collapsed.has(key);
          return <tbody key={key}>
            {grouped && <tr className="live-table__group"><th scope="rowgroup" colSpan={5}>
              <button type="button" aria-expanded={open} onClick={() => toggle(key)}>
                <Icon name={open ? "chevron" : "chevronRight"} size={14} />
                <strong>{group.project ?? "未归属 Compose 项目"}</strong>
                <span>{group.items.length} 个容器{group.cpuPercent !== null ? ` · CPU ${group.cpuPercent.toFixed(1)}%` : ""}{group.memoryBytes !== null ? ` · 内存 ${formatBytes(group.memoryBytes)}` : ""}</span>
              </button>
            </th></tr>}
            {open && group.items.map((item) => <ContainerRow key={item.id} item={item} rate={rates.get(item.id)} />)}
          </tbody>;
        })}
      </table>
    </div>}
    {!data.items.length && <p className="workspace-live__empty">已连接 Docker Engine，本次查询确实没有容器。</p>}
    {data.items.length > 0 && !visible.length && <p className="workspace-live__empty">没有处于“{healthFilters.find((option) => option.id === filter)?.label}”的容器。</p>}
    <LiveNote>
      <p>“—”表示没有取到，不是零。Docker CPU 按单核计数，可超过 100%。网络与磁盘是相邻两次查询之间的速率，所以第一次查询总是“—”。“需要关注”包括不健康、重启中和已失效的容器。</p>
      <p>{data.statsCandidates !== undefined ? "每次最多为 32 个运行中容器读取资源统计，优先最忙的并轮换其余；内存与 docker stats 口径一致，不含可回收的文件缓存。" : "每次最多为 32 个运行中容器读取资源统计；内存是 Engine 原始使用量，升级设备端后与 docker stats 口径一致。"}</p>
    </LiveNote>
  </>;
}
