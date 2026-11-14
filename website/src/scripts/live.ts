/**
 * 「实时查看」面板的示意实现，行为对照 docs/TRUSTED_REALTIME_MONITORING.md：
 *  - 1 / 2 / 5 秒查询间隔；曲线保留两分钟、最多 120 个点，缺失留断点，切换间隔不清空曲线；
 *  - 首次尚无差分基线时 CPU 标为不可用，不以零冒充；
 *  - 暂时性失败时上一次结果继续显示并标注「N 秒前」，超过过期阈值（至少 6 秒）即移除；
 *  - 支持组内同级切换机器（Windows / PVE Linux / Debian）与 ⌘K 命令直达；
 *  - 进程支持按 CPU / 内存 / GPU / 磁盘读写排序（未知值排在已知值之后），悬停或展开详情时固定行顺序；
 *  - 容器支持按运行状态筛选，展示 Compose 项目组、内存上限与磁盘读写速率。
 * 所有数值都是演示数据。
 */
type Pt = { t: number; v: number | null };
type PeerId = 'ws' | 'pve' | 'nas';

const WINDOW = 120_000;

interface Proc {
  name: string;
  pid: number;
  ppid: number;
  cpu: number;
  mem: number;
  gpu: number | null;
  disk: number | null;
  threads: number;
  state: string;
}

interface ContainerRow {
  name: string;
  compose: string;
  image: string;
  up: boolean;
  attention?: boolean;
  cpu: number;
  mem: number;
  memLimit: number;
  rx: number;
  tx: number;
  dr: number;
  dw: number;
}

interface PeerSpec {
  memTotal: number;
  cpuBase: number;
  memBase: number;
  totalProcs: number;
  rates: { dr: number; dw: number; nr: number; nt: number };
  procs: Proc[];
  containers: ContainerRow[];
}

const PEERS: Record<PeerId, PeerSpec> = {
  ws: {
    memTotal: 32,
    cpuBase: 24,
    memBase: 46,
    totalProcs: 214,
    rates: { dr: 12.4, dw: 3.1, nr: 4.8, nt: 0.9 },
    // Windows 端当前不采集逐进程磁盘读写速率，按契约展示为 null（渲染为 —）
    procs: [
      { name: 'blender.exe', pid: 17440, ppid: 6404, cpu: 11.6, mem: 2310, gpu: 38.2, disk: null, threads: 64, state: '运行中' },
      { name: 'chrome.exe', pid: 11284, ppid: 6404, cpu: 6.2, mem: 1460, gpu: 3.1, disk: null, threads: 41, state: '运行中' },
      { name: 'obs64.exe', pid: 12932, ppid: 6404, cpu: 5.1, mem: 520, gpu: 12.6, disk: null, threads: 29, state: '运行中' },
      { name: 'Code.exe', pid: 9020, ppid: 6404, cpu: 4.4, mem: 980, gpu: 0.6, disk: null, threads: 37, state: '运行中' },
      { name: 'node.exe', pid: 15876, ppid: 9020, cpu: 3.8, mem: 640, gpu: null, disk: null, threads: 14, state: '运行中' },
      { name: 'vmmemWSL', pid: 4120, ppid: 4, cpu: 2.9, mem: 3120, gpu: null, disk: null, threads: 16, state: '运行中' },
      { name: 'dwm.exe', pid: 1312, ppid: 792, cpu: 2.1, mem: 210, gpu: 7.4, disk: null, threads: 22, state: '运行中' },
      { name: 'Teams.exe', pid: 13308, ppid: 6404, cpu: 1.7, mem: 610, gpu: 1.4, disk: null, threads: 52, state: '运行中' },
      { name: 'MsMpEng.exe', pid: 3756, ppid: 812, cpu: 1.2, mem: 296, gpu: null, disk: null, threads: 48, state: '运行中' },
      { name: 'System', pid: 4, ppid: 0, cpu: 0.9, mem: 12, gpu: null, disk: null, threads: 236, state: '内核' },
      { name: 'explorer.exe', pid: 6404, ppid: 5980, cpu: 0.6, mem: 182, gpu: 0.2, disk: null, threads: 88, state: '运行中' },
      { name: 'guanlan-agent.exe', pid: 2940, ppid: 812, cpu: 0.3, mem: 34, gpu: null, disk: null, threads: 11, state: '服务' },
    ],
    containers: [
      { name: 'api-1', compose: 'dev-stack', image: 'node:22-alpine', up: true, cpu: 18, mem: 412, memLimit: 1024, rx: 1.2, tx: 0.8, dr: 0.4, dw: 0.2 },
      { name: 'worker-1', compose: 'dev-stack', image: 'ghcr.io/app/worker:main', up: true, attention: true, cpu: 132, mem: 1780, memLimit: 2048, rx: 0.3, tx: 0.2, dr: 8.6, dw: 4.1 },
      { name: 'db-1', compose: 'dev-stack', image: 'mysql:8.4', up: true, cpu: 9, mem: 860, memLimit: 2048, rx: 0.6, tx: 0.9, dr: 1.8, dw: 3.4 },
      { name: 'cache-1', compose: 'dev-stack', image: 'redis:7.4-alpine', up: true, cpu: 2, mem: 96, memLimit: 512, rx: 0.4, tx: 0.4, dr: 0.0, dw: 0.3 },
      { name: 'proxy-1', compose: 'edge', image: 'nginx:1.27-alpine', up: true, cpu: 4, mem: 38, memLimit: 256, rx: 2.4, tx: 2.6, dr: 0.1, dw: 0.1 },
      { name: 'backup-job', compose: 'ops', image: 'restic/restic:latest', up: false, cpu: 0, mem: 0, memLimit: 512, rx: 0, tx: 0, dr: 0, dw: 0 },
    ],
  },
  pve: {
    memTotal: 128,
    cpuBase: 38,
    memBase: 71,
    totalProcs: 342,
    rates: { dr: 64.2, dw: 28.5, nr: 18.4, nt: 14.2 },
    procs: [
      { name: 'kvm (vm-105-ubuntu)', pid: 28410, ppid: 1, cpu: 24.8, mem: 16480, gpu: null, disk: 34.6, threads: 28, state: '运行中' },
      { name: 'kvm (vm-120-macos)', pid: 31904, ppid: 1, cpu: 18.2, mem: 24576, gpu: null, disk: 18.2, threads: 34, state: '运行中' },
      { name: 'zvol_wr_iss', pid: 1094, ppid: 2, cpu: 4.9, mem: 64, gpu: null, disk: 22.8, threads: 8, state: '内核线程' },
      { name: 'pvedaemon', pid: 2418, ppid: 1, cpu: 1.8, mem: 196, gpu: null, disk: 0.4, threads: 4, state: '运行中' },
      { name: 'pvestatd', pid: 2389, ppid: 1, cpu: 1.4, mem: 162, gpu: null, disk: 0.3, threads: 2, state: '运行中' },
      { name: 'corosync', pid: 1940, ppid: 1, cpu: 1.1, mem: 118, gpu: null, disk: 0.1, threads: 6, state: '实时调度' },
      { name: 'ceph-osd.1', pid: 4102, ppid: 1, cpu: 6.4, mem: 4210, gpu: null, disk: 14.9, threads: 54, state: '运行中' },
      { name: 'guanlan-agent', pid: 1822, ppid: 1, cpu: 0.4, mem: 29, gpu: null, disk: 0.05, threads: 9, state: 'systemd' },
    ],
    containers: [
      { name: 'pbs-verify', compose: 'pve-ops', image: 'proxmox/pbs-client:3', up: true, cpu: 26, mem: 540, memLimit: 2048, rx: 6.2, tx: 11.4, dr: 28.0, dw: 1.2 },
      { name: 'nut-upsd', compose: 'pve-ops', image: 'instantlinux/nut-upsd', up: true, cpu: 1, mem: 24, memLimit: 128, rx: 0.02, tx: 0.02, dr: 0, dw: 0 },
      { name: 'smart-exporter', compose: 'pve-ops', image: 'prometheuscommunity/smartctl', up: true, cpu: 2, mem: 36, memLimit: 256, rx: 0.05, tx: 0.08, dr: 0.2, dw: 0 },
    ],
  },
  nas: {
    memTotal: 64,
    cpuBase: 16,
    memBase: 75,
    totalProcs: 186,
    rates: { dr: 92.0, dw: 41.6, nr: 36.5, nt: 52.1 },
    procs: [
      { name: 'smbd', pid: 8821, ppid: 1420, cpu: 7.4, mem: 312, gpu: null, disk: 68.4, threads: 6, state: '运行中' },
      { name: 'mysqld', pid: 3306, ppid: 1, cpu: 4.8, mem: 2840, gpu: null, disk: 9.6, threads: 46, state: '运行中' },
      { name: 'guanlan-server', pid: 4012, ppid: 1, cpu: 2.3, mem: 268, gpu: null, disk: 0.8, threads: 12, state: '运行中' },
      { name: 'immich-ml', pid: 9410, ppid: 1, cpu: 9.2, mem: 1920, gpu: 24.5, disk: 4.2, threads: 18, state: '运行中' },
      { name: 'redis-server', pid: 6379, ppid: 1, cpu: 1.1, mem: 184, gpu: null, disk: 1.4, threads: 6, state: '运行中' },
      { name: 'nginx', pid: 4088, ppid: 1, cpu: 0.7, mem: 42, gpu: null, disk: 0.1, threads: 4, state: '运行中' },
      { name: 'guanlan-agent', pid: 1604, ppid: 1, cpu: 0.3, mem: 28, gpu: null, disk: 0.04, threads: 9, state: 'systemd' },
    ],
    containers: [
      { name: 'guanlan-web', compose: 'guanlan-hub', image: 'ghcr.io/igngserver/guanlan-web:3.0.174', up: true, cpu: 2, mem: 44, memLimit: 256, rx: 1.8, tx: 3.4, dr: 0.05, dw: 0.02 },
      { name: 'guanlan-server', compose: 'guanlan-hub', image: 'ghcr.io/igngserver/guanlan-server:3.0.174', up: true, cpu: 6, mem: 268, memLimit: 1024, rx: 1.6, tx: 1.9, dr: 0.4, dw: 0.8 },
      { name: 'guanlan-mysql', compose: 'guanlan-hub', image: 'mysql:8.4', up: true, cpu: 11, mem: 1680, memLimit: 4096, rx: 0.9, tx: 1.1, dr: 4.2, dw: 8.6 },
      { name: 'guanlan-redis', compose: 'guanlan-hub', image: 'redis:7.4-alpine', up: true, cpu: 3, mem: 184, memLimit: 512, rx: 0.7, tx: 0.7, dr: 0.1, dw: 1.2 },
      { name: 'jellyfin', compose: 'media-stack', image: 'jellyfin/jellyfin:latest', up: true, attention: true, cpu: 164, mem: 3620, memLimit: 4096, rx: 4.2, tx: 38.6, dr: 54.0, dw: 6.4 },
      { name: 'rclone-onedrive', compose: 'ops-sync', image: 'rclone/rclone:latest', up: false, cpu: 0, mem: 0, memLimit: 512, rx: 0, tx: 0, dr: 0, dw: 0 },
    ],
  },
};

const jitter = (v: number, amt: number, lo = 0, hi = Infinity) =>
  Math.min(hi, Math.max(lo, v + (Math.random() - 0.5) * amt));

export function initLive(): void {
  const root = document.querySelector<HTMLElement>('[data-live]');
  if (!root) return;
  const $ = <T extends Element>(s: string) => root.querySelector<T>(s)!;
  const pill = $<HTMLElement>('[data-pill]');
  const pillText = $<HTMLElement>('[data-pill-text]');
  const sampled = $<HTMLElement>('[data-sampled]');
  const pauseBtn = $<HTMLButtonElement>('[data-pause]');
  const failBtn = $<HTMLButtonElement>('[data-fail]');
  const cmdkToggle = $<HTMLButtonElement>('[data-cmdk-toggle]');
  const cmdkBar = $<HTMLElement>('[data-cmdk-bar]');
  const cmdkInput = $<HTMLInputElement>('[data-cmdk-input]');
  const cmdkJumps = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-cmdk-jump]'));
  const peers = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-peer]'));
  const intervals = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-interval]'));
  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-tab]'));
  const panes = Array.from(root.querySelectorAll<HTMLElement>('[data-pane]'));
  const sorts = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-sort]'));
  const cfilters = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-cfilter]'));
  const procBody = $<HTMLElement>('[data-proc]');
  const procMeta = $<HTMLElement>('[data-proc-meta]');
  const procHold = $<HTMLElement>('[data-proc-hold]');
  const procSearch = $<HTMLInputElement>('[data-proc-search]');
  const procDetail = $<HTMLElement>('[data-proc-detail]');
  const dockBody = $<HTMLElement>('[data-docker]');
  const dockMeta = $<HTMLElement>('[data-docker-meta]');
  const charts = {
    cpu: chart(root.querySelector('[data-chart="cpu"]')!, '255,166,74'),
    mem: chart(root.querySelector('[data-chart="mem"]')!, '233,230,223'),
  };

  let peerId: PeerId = 'ws';
  let interval = 1;
  let paused = false;
  let failUntil = 0;
  let lastGood = 0;
  let baseline = false;
  let cpu = PEERS.ws.cpuBase;
  let mem = PEERS.ws.memBase;
  let memTotal = PEERS.ws.memTotal;
  let sortKey: 'cpu' | 'mem' | 'gpu' | 'disk' = 'cpu';
  let cfilter: 'all' | 'running' | 'attention' | 'stopped' = 'all';
  let query = '';
  let pointerHover = false;
  let selectedPid: number | null = null;
  let frozenOrder: number[] | null = null;
  let procs = PEERS.ws.procs.map((p) => ({ ...p }));
  let docker = PEERS.ws.containers.map((c) => ({ ...c }));
  let rates = { ...PEERS.ws.rates };
  let total = PEERS.ws.totalProcs;
  let has = false;
  const series: Record<'cpu' | 'mem', Pt[]> = { cpu: [], mem: [] };

  function seedPeer(id: PeerId) {
    peerId = id;
    const spec = PEERS[id];
    memTotal = spec.memTotal;
    cpu = spec.cpuBase;
    mem = spec.memBase;
    procs = spec.procs.map((p) => ({ ...p }));
    docker = spec.containers.map((c) => ({ ...c }));
    rates = { ...spec.rates };
    total = spec.totalProcs;
    selectedPid = null;
    frozenOrder = null;
    series.cpu.length = 0;
    series.mem.length = 0;
    const now0 = Date.now();
    for (let k = 60; k > 0; k--) {
      const t = now0 - k * 1000;
      cpu = jitter(cpu * 0.9 + spec.cpuBase * 0.1, 9, 3, 97);
      mem = jitter(mem, 0.4, 24, 92);
      series.cpu.push({ t, v: k === 60 ? null : cpu });
      series.mem.push({ t, v: mem });
    }
    baseline = true;
    has = true;
    lastGood = now0 - 1000;
    peers.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.peer === id)));
  }

  seedPeer('ws');

  const fmtRate = (v: number) => (v >= 1 ? `${v.toFixed(1)} MB/s` : `${(v * 1024).toFixed(0)} KB/s`);
  const time = (t: number) => new Date(t).toLocaleTimeString('zh-CN', { hour12: false });

  function sample() {
    const t = Date.now();
    if (t < failUntil) {
      series.cpu.push({ t, v: null });
      series.mem.push({ t, v: null });
      trim();
      return;
    }
    const base = PEERS[peerId].cpuBase;
    cpu = jitter(cpu * 0.85 + base * 0.15 + (Math.random() < 0.06 ? 26 : 0), 10, 2, 98);
    mem = jitter(mem, 0.5, 24, 92);
    series.cpu.push({ t, v: baseline ? cpu : null });
    series.mem.push({ t, v: mem });
    baseline = true;
    has = true;
    lastGood = t;
    rates = {
      dr: jitter(rates.dr, 6, 0.1, 400),
      dw: jitter(rates.dw, 2.4, 0.05, 200),
      nr: jitter(rates.nr, 2.5, 0.05, 140),
      nt: jitter(rates.nt, 1.4, 0.02, 140),
    };
    procs = procs.map((p) => ({
      ...p,
      cpu: jitter(p.cpu, p.cpu * 0.45 + 0.4, 0, 100),
      mem: jitter(p.mem, p.mem * 0.02, 1),
      gpu: p.gpu === null ? null : jitter(p.gpu, p.gpu * 0.35 + 0.4, 0, 100),
      disk: p.disk === null ? null : jitter(p.disk, p.disk * 0.35 + 0.2, 0.01, 240),
    }));
    docker = docker.map((c) =>
      c.up
        ? {
            ...c,
            cpu: jitter(c.cpu, c.cpu * 0.28 + 1, 0, 400),
            rx: jitter(c.rx, 0.5, 0.01),
            tx: jitter(c.tx, 0.6, 0.01),
            dr: jitter(c.dr, 0.8, 0),
            dw: jitter(c.dw, 0.6, 0),
          }
        : c,
    );
    total = Math.round(jitter(total, 3, 170, 360));
    trim();
    render();
  }

  function trim() {
    for (const k of ['cpu', 'mem'] as const) {
      const s = series[k];
      while (s.length && (s[0]!.t < Date.now() - WINDOW || s.length > 120)) s.shift();
    }
  }

  function sortProcs(list: Proc[]): Proc[] {
    return [...list].sort((a, b) => {
      const x = a[sortKey];
      const y = b[sortKey];
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return y - x;
    });
  }

  function render() {
    const show = has;
    const c = series.cpu.at(-1);
    const lastCpu = [...series.cpu].reverse().find((p) => p.v !== null)?.v ?? null;
    const lastMem = [...series.mem].reverse().find((p) => p.v !== null)?.v ?? null;
    charts.cpu.value.innerHTML =
      show && lastCpu !== null && c ? `${lastCpu.toFixed(1)}<small>%</small>` : '<span class="faint">不可用</span>';
    charts.mem.value.innerHTML = show && lastMem !== null ? `${lastMem.toFixed(1)}<small>%</small>` : '—';
    const memSub = root!.querySelector('[data-mem-cap]');
    if (memSub) {
      memSub.textContent =
        show && lastMem !== null
          ? `${((lastMem / 100) * memTotal).toFixed(1)} / ${memTotal.toFixed(1)} GB`
          : `— / ${memTotal.toFixed(1)} GB`;
    }
    for (const [k, v] of Object.entries(rates)) {
      const el = root!.querySelector(`[data-rate="${k}"]`);
      if (el) el.textContent = show ? fmtRate(v) : '—';
    }
    sampled.textContent = show ? `采集于 ${time(lastGood)}` : '结果已移除';

    const holding = pointerHover || selectedPid !== null;
    procHold.hidden = !holding;

    const q = query.trim().toLowerCase();
    const filtered = q
      ? procs.filter((p) => p.name.toLowerCase().includes(q) || String(p.pid).includes(q))
      : procs;

    let ordered: Proc[];
    if (holding && frozenOrder) {
      const rank = new Map(frozenOrder.map((pid, idx) => [pid, idx]));
      ordered = [...filtered].sort((a, b) => (rank.get(a.pid) ?? 999) - (rank.get(b.pid) ?? 999));
    } else {
      ordered = sortProcs(filtered);
      frozenOrder = ordered.map((p) => p.pid);
    }

    const diskNote = peerId === 'ws' ? 'Windows 进程磁盘速率标为 —' : 'Linux 采集逐进程读写速率';
    procMeta.textContent = `枚举 ${total} 个进程 · 显示 ${ordered.length} 行 · ${diskNote}`;
    procBody.innerHTML = show
      ? ordered.length
        ? ordered
            .map(
              (p) =>
                `<tr data-pid="${p.pid}" class="${selectedPid === p.pid ? 'is-sel' : ''}"><td>${p.name}</td><td class="num">${p.pid}</td><td class="num"><span class="bar"><i style="width:${Math.min(100, p.cpu)}%"></i></span>${p.cpu.toFixed(1)}%</td><td class="num">${p.mem >= 1024 ? (p.mem / 1024).toFixed(2) + ' GB' : p.mem.toFixed(0) + ' MB'}</td><td class="num">${p.gpu === null ? '<span class="na">—</span>' : p.gpu.toFixed(1) + '%'}</td><td class="num">${p.disk === null ? '<span class="na">—</span>' : fmtRate(p.disk)}</td><td class="num">${p.threads}</td></tr>`,
            )
            .join('')
        : `<tr><td colspan="7" class="na">没有匹配「${q}」的进程</td></tr>`
      : `<tr><td colspan="7" class="na">结果已过期移除，等待下一次成功查询</td></tr>`;

    const sel = selectedPid !== null ? procs.find((p) => p.pid === selectedPid) : null;
    if (show && sel) {
      procDetail.hidden = false;
      const ioSplit =
        sel.disk === null
          ? '磁盘读写：当前平台未暴露'
          : `读 ${fmtRate(sel.disk * 0.62)} · 写 ${fmtRate(sel.disk * 0.38)}`;
      procDetail.innerHTML = `<span><strong class="amber">${sel.name}</strong> · PID ${sel.pid} · 父进程 PPID ${sel.ppid} · 状态：${sel.state}</span><span>${ioSplit} · 点击该行取消固定</span>`;
    } else {
      procDetail.hidden = true;
    }

    const runningCount = docker.filter((c) => c.up).length;
    const dockFiltered = docker.filter((c) => {
      if (cfilter === 'running') return c.up;
      if (cfilter === 'attention') return Boolean(c.attention) || !c.up;
      if (cfilter === 'stopped') return !c.up;
      return true;
    });
    dockMeta.textContent = `只读 Engine API · 已采集 ${runningCount} / ${docker.length} 容器实时速率（CPU 按单核口径可超 100%）`;
    dockBody.innerHTML = show
      ? dockFiltered.length
        ? dockFiltered
            .map((c) => {
              const stClass = !c.up ? 'st-down' : c.attention ? 'st-warn' : 'st-up';
              const stLabel = !c.up ? '未运行' : c.attention ? '高占用' : '运行中';
              const memPct = c.memLimit > 0 ? Math.round((c.mem / c.memLimit) * 100) : 0;
              return `<tr><td>${c.name}<span class="c-sub">compose: ${c.compose} · ${c.image}</span></td><td class="${stClass}">${stLabel}</td><td class="num">${c.up ? c.cpu.toFixed(0) + '%' : '<span class="na">—</span>'}</td><td class="num">${c.up ? `${c.mem.toFixed(0)} / ${c.memLimit} MB (${memPct}%)` : '<span class="na">—</span>'}</td><td class="num">${c.up ? fmtRate(c.rx) + ' / ' + fmtRate(c.tx) : '<span class="na">—</span>'}</td><td class="num">${c.up ? fmtRate(c.dr) + ' / ' + fmtRate(c.dw) : '<span class="na">—</span>'}</td></tr>`;
            })
            .join('')
        : `<tr><td colspan="6" class="na">当前筛选条件下无容器</td></tr>`
      : `<tr><td colspan="6" class="na">结果已过期移除，等待下一次成功查询</td></tr>`;
  }

  function status() {
    const now = Date.now();
    const age = Math.round((now - lastGood) / 1000);
    const threshold = Math.max(6, interval * 2);
    let state = 'live';
    let text = '实时 · 刚刚';
    if (paused) {
      state = 'paused';
      text = '已暂停';
    } else if (now < failUntil + interval * 1000 + 300 && age >= 1) {
      if (age > threshold) {
        state = 'gone';
        text = '已过期 · 等待恢复';
        if (has) {
          has = false;
          render();
        }
      } else {
        state = 'stale';
        text = `采集忙 · ${age} 秒前`;
      }
    }
    pill.dataset.state = state;
    pillText.textContent = text;
  }

  let timer = 0;
  const schedule = () => {
    window.clearInterval(timer);
    timer = window.setInterval(() => {
      if (!paused && visible && !document.hidden) sample();
    }, interval * 1000);
  };

  const selectTab = (tab: HTMLButtonElement) => {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    panes.forEach((p) => (p.hidden = p.dataset.pane !== tab.dataset.tab));
    charts.cpu.resize();
    charts.mem.resize();
  };

  const setCmdk = (open: boolean) => {
    cmdkBar.hidden = !open;
    cmdkToggle.setAttribute('aria-expanded', String(open));
    if (open) cmdkInput.focus();
  };

  peers.forEach((b) =>
    b.addEventListener('click', () => {
      const id = (b.dataset.peer as PeerId) || 'ws';
      seedPeer(id);
      render();
    }),
  );

  cmdkToggle.addEventListener('click', () => setCmdk(Boolean(cmdkBar.hidden)));
  cmdkInput.addEventListener('input', () => {
    const v = cmdkInput.value.trim().toLowerCase();
    cmdkJumps.forEach((j) => {
      j.hidden = Boolean(v) && !j.textContent!.toLowerCase().includes(v);
    });
  });
  cmdkInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setCmdk(false);
    if (e.key === 'Enter') {
      const first = cmdkJumps.find((j) => !j.hidden);
      first?.click();
    }
  });
  cmdkJumps.forEach((j) =>
    j.addEventListener('click', () => {
      const [targetPeer, targetTab] = (j.dataset.cmdkJump || 'ws:perf').split(':') as [PeerId, string];
      seedPeer(targetPeer);
      const tabBtn = tabs.find((t) => t.dataset.tab === targetTab);
      if (tabBtn) selectTab(tabBtn);
      if (targetPeer === 'pve' && targetTab === 'proc') {
        sortKey = 'disk';
        sorts.forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.sort === 'disk')));
      } else if (targetPeer === 'ws' && targetTab === 'proc') {
        sortKey = 'gpu';
        sorts.forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.sort === 'gpu')));
      }
      setCmdk(false);
      render();
    }),
  );

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && visible) {
      e.preventDefault();
      setCmdk(Boolean(cmdkBar.hidden));
    }
  });

  intervals.forEach((b) =>
    b.addEventListener('click', () => {
      interval = Number(b.dataset.interval);
      intervals.forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      schedule();
    }),
  );
  pauseBtn.addEventListener('click', () => {
    paused = !paused;
    pauseBtn.setAttribute('aria-pressed', String(paused));
    pauseBtn.textContent = paused ? '继续' : '暂停';
    status();
  });
  failBtn.addEventListener('click', () => {
    failUntil = Date.now() + 11_000;
    status();
  });
  sorts.forEach((b) =>
    b.addEventListener('click', () => {
      sortKey = b.dataset.sort as typeof sortKey;
      frozenOrder = null;
      sorts.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      const prevHover = pointerHover;
      const prevSel = selectedPid;
      pointerHover = false;
      selectedPid = null;
      render();
      pointerHover = prevHover;
      selectedPid = prevSel;
    }),
  );

  procSearch.addEventListener('input', () => {
    query = procSearch.value;
    frozenOrder = null;
    render();
  });

  procBody.addEventListener('pointerenter', (e) => {
    if (e.pointerType === 'mouse') {
      pointerHover = true;
      procHold.hidden = false;
    }
  });
  procBody.addEventListener('pointerleave', () => {
    pointerHover = false;
    procHold.hidden = selectedPid === null;
  });
  procBody.addEventListener('click', (e) => {
    const tr = (e.target as HTMLElement).closest<HTMLTableRowElement>('tr[data-pid]');
    if (!tr) return;
    const pid = Number(tr.dataset.pid);
    selectedPid = selectedPid === pid ? null : pid;
    render();
  });

  cfilters.forEach((b) =>
    b.addEventListener('click', () => {
      cfilter = (b.dataset.cfilter as typeof cfilter) || 'all';
      cfilters.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      render();
    }),
  );

  tabs.forEach((t, i) => {
    t.addEventListener('click', () => selectTab(t));
    t.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      const next = tabs[(i + d + tabs.length) % tabs.length]!;
      next.focus();
      selectTab(next);
    });
  });

  let visible = false;
  let raf = 0;
  const frame = () => {
    raf = 0;
    status();
    charts.cpu.draw(series.cpu, interval * 2500);
    charts.mem.draw(series.mem, interval * 2500);
    if (visible) raf = requestAnimationFrame(frame);
  };
  new IntersectionObserver(([e]) => {
    const was = visible;
    visible = !!e?.isIntersecting;
    if (visible && !was && !paused && !document.hidden) sample();
    if (visible && !raf) raf = requestAnimationFrame(frame);
  }).observe(root);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && visible && !paused) sample();
  });

  render();
  schedule();
  window.addEventListener('resize', () => {
    charts.cpu.resize();
    charts.mem.resize();
  });
}

function chart(fig: HTMLElement, rgb: string) {
  const canvas = fig.querySelector('canvas')!;
  const value = fig.querySelector<HTMLElement>('[data-value]')!;
  const ctx = canvas.getContext('2d')!;
  let w = 0;
  let h = 0;
  let dpr = 1;
  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  };
  resize();

  const draw = (pts: Pt[], maxGap: number) => {
    if (!w) resize();
    if (!w) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const padL = 34;
    const now = Date.now();
    const x = (t: number) => padL + ((t - (now - WINDOW)) / WINDOW) * (w - padL);
    const y = (v: number) => 6 + (1 - v / 100) * (h - 22);
    ctx.font = '10px "Geist Mono Variable", ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    for (const g of [0, 25, 50, 75, 100]) {
      ctx.strokeStyle = g === 0 ? 'rgba(233,230,223,0.16)' : 'rgba(233,230,223,0.06)';
      ctx.beginPath();
      ctx.moveTo(padL, y(g));
      ctx.lineTo(w, y(g));
      ctx.stroke();
      ctx.fillStyle = 'rgba(233,230,223,0.32)';
      ctx.fillText(`${g}%`, 0, y(g));
    }
    ctx.fillStyle = 'rgba(233,230,223,0.32)';
    ctx.fillText('−2 分钟', padL, h - 6);
    const nowLabel = '现在';
    ctx.fillText(nowLabel, w - ctx.measureText(nowLabel).width, h - 6);

    const runs: Pt[][] = [];
    let cur: Pt[] = [];
    let prev = -Infinity;
    for (const p of pts) {
      if (p.v === null || p.t - prev > maxGap) {
        if (cur.length) runs.push(cur);
        cur = [];
      }
      if (p.v !== null) cur.push(p);
      prev = p.t;
    }
    if (cur.length) runs.push(cur);
    for (const run of runs) {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, `rgba(${rgb},0.22)`);
      grad.addColorStop(1, `rgba(${rgb},0)`);
      ctx.beginPath();
      run.forEach((p, i) => (i ? ctx.lineTo(x(p.t), y(p.v!)) : ctx.moveTo(x(p.t), y(p.v!))));
      ctx.lineTo(x(run.at(-1)!.t), y(0));
      ctx.lineTo(x(run[0]!.t), y(0));
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.beginPath();
      run.forEach((p, i) => (i ? ctx.lineTo(x(p.t), y(p.v!)) : ctx.moveTo(x(p.t), y(p.v!))));
      ctx.strokeStyle = `rgba(${rgb},0.95)`;
      ctx.lineWidth = 1.4;
      ctx.lineJoin = 'round';
      ctx.stroke();
      if (run.length === 1) {
        ctx.beginPath();
        ctx.arc(x(run[0]!.t), y(run[0]!.v!), 1.6, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${rgb},1)`;
        ctx.fill();
      }
    }
    const lastPt = pts.at(-1);
    if (lastPt && lastPt.v !== null) {
      ctx.beginPath();
      ctx.arc(x(lastPt.t), y(lastPt.v), 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${rgb},1)`;
      ctx.fill();
    }
  };
  return { draw, resize, value };
}
