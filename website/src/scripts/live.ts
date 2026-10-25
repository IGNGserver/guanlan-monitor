/**
 * 「实时查看」面板的示意实现，行为对照 docs/TRUSTED_REALTIME_MONITORING.md：
 *  - 1 / 2 / 5 秒查询间隔；曲线保留两分钟、最多 120 个点，缺失留断点，切换间隔不清空曲线；
 *  - 首次尚无差分基线时 CPU 标为不可用，不以零冒充；
 *  - 暂时性失败时上一次结果继续显示并标注「N 秒前」，超过过期阈值（至少 6 秒）即移除；
 *  - 进程按 CPU / 内存 / GPU 排序，未知值排在已知值之后；Docker 只读，CPU 按单核口径可超过 100%。
 * 所有数值都是演示数据。
 */
type Pt = { t: number; v: number | null };

const WINDOW = 120_000;
const MEM_TOTAL = 32;

interface Proc {
  name: string;
  pid: number;
  cpu: number;
  mem: number;
  gpu: number | null;
  threads: number;
}

const PROCS: Proc[] = [
  { name: 'chrome.exe', pid: 11284, cpu: 6.2, mem: 1460, gpu: 3.1, threads: 41 },
  { name: 'Code.exe', pid: 9020, cpu: 4.4, mem: 980, gpu: 0.6, threads: 37 },
  { name: 'dwm.exe', pid: 1312, cpu: 2.1, mem: 210, gpu: 7.4, threads: 22 },
  { name: 'node.exe', pid: 15876, cpu: 3.8, mem: 640, gpu: null, threads: 14 },
  { name: 'blender.exe', pid: 17440, cpu: 11.6, mem: 2310, gpu: 38.2, threads: 64 },
  { name: 'explorer.exe', pid: 6404, cpu: 0.6, mem: 182, gpu: 0.2, threads: 88 },
  { name: 'vmmem', pid: 4120, cpu: 2.9, mem: 3120, gpu: null, threads: 16 },
  { name: 'svchost.exe', pid: 1880, cpu: 0.4, mem: 64, gpu: null, threads: 12 },
  { name: 'MsMpEng.exe', pid: 3756, cpu: 1.2, mem: 296, gpu: null, threads: 48 },
  { name: 'obs64.exe', pid: 12932, cpu: 5.1, mem: 520, gpu: 12.6, threads: 29 },
  { name: 'Teams.exe', pid: 13308, cpu: 1.7, mem: 610, gpu: 1.4, threads: 52 },
  { name: 'System', pid: 4, cpu: 0.9, mem: 8, gpu: null, threads: 236 },
];

const CONTAINERS = [
  { name: 'api-1', up: true, cpu: 18, mem: 412, rx: 1.2, tx: 0.8 },
  { name: 'worker-1', up: true, cpu: 132, mem: 1180, rx: 0.3, tx: 0.2 },
  { name: 'db-1', up: true, cpu: 9, mem: 860, rx: 0.6, tx: 0.9 },
  { name: 'cache-1', up: true, cpu: 2, mem: 96, rx: 0.4, tx: 0.4 },
  { name: 'proxy-1', up: true, cpu: 4, mem: 38, rx: 2.4, tx: 2.6 },
  { name: 'backup-job', up: false, cpu: 0, mem: 0, rx: 0, tx: 0 },
];

const jitter = (v: number, amt: number, lo = 0, hi = Infinity) => Math.min(hi, Math.max(lo, v + (Math.random() - 0.5) * amt));

export function initLive(): void {
  const root = document.querySelector<HTMLElement>('[data-live]');
  if (!root) return;
  const $ = <T extends Element>(s: string) => root.querySelector<T>(s)!;
  const pill = $<HTMLElement>('[data-pill]');
  const pillText = $<HTMLElement>('[data-pill-text]');
  const sampled = $<HTMLElement>('[data-sampled]');
  const pauseBtn = $<HTMLButtonElement>('[data-pause]');
  const failBtn = $<HTMLButtonElement>('[data-fail]');
  const intervals = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-interval]'));
  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-tab]'));
  const panes = Array.from(root.querySelectorAll<HTMLElement>('[data-pane]'));
  const sorts = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-sort]'));
  const procBody = $<HTMLElement>('[data-proc]');
  const procMeta = $<HTMLElement>('[data-proc-meta]');
  const dockBody = $<HTMLElement>('[data-docker]');
  const charts = {
    cpu: chart(root.querySelector('[data-chart="cpu"]')!, '255,166,74'),
    mem: chart(root.querySelector('[data-chart="mem"]')!, '233,230,223'),
  };

  let interval = 1;
  let paused = false;
  let failUntil = 0;
  let lastGood = 0;
  let baseline = false;
  let cpu = 22;
  let mem = 44;
  let sortKey: 'cpu' | 'mem' | 'gpu' = 'cpu';
  let procs = PROCS.map((p) => ({ ...p }));
  let docker = CONTAINERS.map((c) => ({ ...c }));
  let rates = { dr: 12.4, dw: 3.1, nr: 4.8, nt: 0.9 };
  let total = 214;
  let has = false;
  const series: Record<'cpu' | 'mem', Pt[]> = { cpu: [], mem: [] };

  // 预填约一分钟的历史，让曲线一开始就有形状（首个点 CPU 为不可用）
  const now0 = Date.now();
  for (let k = 60; k > 0; k--) {
    const t = now0 - k * 1000;
    cpu = jitter(cpu * 0.9 + 24 * 0.1, 9, 3, 97);
    mem = jitter(mem, 0.4, 30, 90);
    series.cpu.push({ t, v: k === 60 ? null : cpu });
    series.mem.push({ t, v: mem });
  }
  baseline = true;
  has = true;
  lastGood = now0 - 1000;

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
    cpu = jitter(cpu * 0.85 + 24 * 0.15 + (Math.random() < 0.06 ? 30 : 0), 10, 2, 98);
    mem = jitter(mem, 0.5, 30, 90);
    series.cpu.push({ t, v: baseline ? cpu : null });
    series.mem.push({ t, v: mem });
    baseline = true;
    has = true;
    lastGood = t;
    rates = { dr: jitter(rates.dr, 6, 0.1, 400), dw: jitter(rates.dw, 2, 0.05, 200), nr: jitter(rates.nr, 2.5, 0.05, 110), nt: jitter(rates.nt, 0.6, 0.02, 110) };
    procs = procs.map((p) => ({ ...p, cpu: jitter(p.cpu, p.cpu * 0.5 + 0.4, 0, 100), mem: jitter(p.mem, p.mem * 0.02, 1), gpu: p.gpu === null ? null : jitter(p.gpu, p.gpu * 0.4 + 0.4, 0, 100) }));
    docker = docker.map((c) => (c.up ? { ...c, cpu: jitter(c.cpu, c.cpu * 0.3 + 1, 0, 400), rx: jitter(c.rx, 0.6, 0.01), tx: jitter(c.tx, 0.6, 0.01) } : c));
    total = Math.round(jitter(total, 3, 200, 230));
    trim();
    render();
  }

  function trim() {
    for (const k of ['cpu', 'mem'] as const) {
      const s = series[k];
      while (s.length && (s[0]!.t < Date.now() - WINDOW || s.length > 120)) s.shift();
    }
  }

  function render() {
    const show = has;
    const c = series.cpu.at(-1);
    const lastCpu = [...series.cpu].reverse().find((p) => p.v !== null)?.v ?? null;
    const lastMem = [...series.mem].reverse().find((p) => p.v !== null)?.v ?? null;
    charts.cpu.value.innerHTML = show && lastCpu !== null && c ? `${lastCpu.toFixed(1)}<small>%</small>` : '<span class="faint">不可用</span>';
    charts.mem.value.innerHTML = show && lastMem !== null ? `${lastMem.toFixed(1)}<small>%</small>` : '—';
    const memSub = root!.querySelector('[data-chart="mem"] small');
    if (memSub) memSub.textContent = show && lastMem !== null ? `${((lastMem / 100) * MEM_TOTAL).toFixed(1)} / ${MEM_TOTAL.toFixed(1)} GB` : `— / ${MEM_TOTAL.toFixed(1)} GB`;
    for (const [k, v] of Object.entries(rates)) {
      const el = root!.querySelector(`[data-rate="${k}"]`);
      if (el) el.textContent = show ? fmtRate(v) : '—';
    }
    sampled.textContent = show ? `采集于 ${time(lastGood)}` : '结果已移除';

    const sorted = [...procs].sort((a, b) => {
      const x = a[sortKey];
      const y = b[sortKey];
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return y - x;
    });
    procMeta.textContent = `系统枚举 ${total} 个进程 · 返回占用最高的进程 · 每页最多 50 行（示意仅列 12 行）`;
    procBody.innerHTML = show
      ? sorted
          .map(
            (p) => `<tr><td>${p.name}</td><td class="num">${p.pid}</td><td class="num"><span class="bar"><i style="width:${Math.min(100, p.cpu)}%"></i></span>${p.cpu.toFixed(1)}%</td><td class="num">${p.mem >= 1024 ? (p.mem / 1024).toFixed(2) + ' GB' : p.mem.toFixed(0) + ' MB'}</td><td class="num">${p.gpu === null ? '<span class="na">—</span>' : p.gpu.toFixed(1) + '%'}</td><td class="num">${p.threads}</td></tr>`,
          )
          .join('')
      : `<tr><td colspan="6" class="na">结果已过期移除，等待下一次成功查询</td></tr>`;
    dockBody.innerHTML = show
      ? docker
          .map(
            (c) => `<tr><td>${c.name}</td><td class="${c.up ? 'st-up' : 'st-down'}">${c.up ? '运行中' : '已退出'}</td><td class="num">${c.up ? c.cpu.toFixed(0) + '%' : '<span class="na">—</span>'}</td><td class="num">${c.up ? c.mem.toFixed(0) + ' MB' : '<span class="na">—</span>'}</td><td class="num">${c.up ? fmtRate(c.rx) + ' / ' + fmtRate(c.tx) : '<span class="na">—</span>'}</td></tr>`,
          )
          .join('')
      : `<tr><td colspan="5" class="na">结果已过期移除，等待下一次成功查询</td></tr>`;
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

  // 定时查询
  let timer = 0;
  const schedule = () => {
    window.clearInterval(timer);
    timer = window.setInterval(() => {
      if (!paused && visible && !document.hidden) sample();
    }, interval * 1000);
  };

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
      sorts.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      render();
    }),
  );
  const select = (tab: HTMLButtonElement) => {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    panes.forEach((p) => (p.hidden = p.dataset.pane !== tab.dataset.tab));
    charts.cpu.resize();
    charts.mem.resize();
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      const next = tabs[(i + d + tabs.length) % tabs.length]!;
      next.focus();
      select(next);
    });
  });

  // 只在可见时运行
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
    // 重新可见时先查一次，避免把「没在看」误当成「采集失败」
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

    // 线段：遇到 null 断开
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
