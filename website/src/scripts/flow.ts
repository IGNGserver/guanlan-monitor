/**
 * 数据流示意：Agent → 中枢 → 终端。画布叠在 HTML 节点之上，连线按节点的实际位置计算，
 * 桌面横排、手机竖排都能对上。断开链路时，样本在各 Agent 本地排队；恢复后按顺序补传。
 */
interface Packet {
  edge: number;
  t: number;
  speed: number;
  replay: boolean;
}

interface Edge {
  from: HTMLElement;
  to: HTMLElement;
  kind: 'up' | 'down';
  agent?: number;
  p: [number, number, number, number, number, number, number, number];
}

const AMBER = '255,166,74';
const TEAL = '53,216,182';

export function initFlow(): void {
  const board = document.querySelector<HTMLElement>('[data-flow]');
  const canvas = board?.querySelector('canvas');
  const btn = document.querySelector<HTMLButtonElement>('[data-cut]');
  if (!board || !canvas || !btn) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const agents = Array.from(board.querySelectorAll<HTMLElement>('.node--agent'));
  const clients = Array.from(board.querySelectorAll<HTMLElement>('.node--client'));
  const hub = board.querySelector<HTMLElement>('.node--hub')!;
  const link = board.querySelector<HTMLElement>('[data-link]')!;
  const linkText = board.querySelector<HTMLElement>('[data-link-text]')!;
  const label = btn.querySelector<HTMLElement>('[data-cut-label]')!;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const edges: Edge[] = [
    ...agents.map((a, i) => ({ from: a, to: hub, kind: 'up' as const, agent: i, p: [0, 0, 0, 0, 0, 0, 0, 0] as Edge['p'] })),
    ...clients.map((c) => ({ from: hub, to: c, kind: 'down' as const, p: [0, 0, 0, 0, 0, 0, 0, 0] as Edge['p'] })),
  ];
  const queues = agents.map(() => 0);
  const packets: Packet[] = [];
  const nextSpawn = agents.map(() => Math.random() * 1.2);
  let offline = false;
  let replaying = false;
  let w = 0;
  let h = 0;
  let dpr = 1;

  const layout = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = board.getBoundingClientRect();
    w = r.width;
    h = r.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const vertical = hub.getBoundingClientRect().top > agents[0]!.getBoundingClientRect().bottom;
    for (const e of edges) {
      const a = e.from.getBoundingClientRect();
      const b = e.to.getBoundingClientRect();
      let x0, y0, x1, y1;
      if (vertical) {
        x0 = a.left + a.width / 2 - r.left;
        y0 = a.bottom - r.top;
        x1 = b.left + b.width / 2 - r.left;
        y1 = b.top - r.top;
        if (e.kind === 'down') x0 = x1 * 0.4 + x0 * 0.6;
        if (e.kind === 'up') x1 = x0 * 0.4 + x1 * 0.6;
        const m = (y1 - y0) * 0.5;
        e.p = [x0, y0, x0, y0 + m, x1, y1 - m, x1, y1];
      } else {
        x0 = a.right - r.left;
        y0 = a.top + a.height / 2 - r.top;
        x1 = b.left - r.left;
        y1 = b.top + b.height / 2 - r.top;
        if (e.kind === 'up') y1 = b.top - r.top + 52 + (e.agent ?? 0) * ((b.height - 104) / 3);
        if (e.kind === 'down') y0 = a.top - r.top + 52 + clients.indexOf(e.to) * ((a.height - 104) / 3);
        const m = (x1 - x0) * 0.5;
        e.p = [x0, y0, x0 + m, y0, x1 - m, y1, x1, y1];
      }
    }
  };

  const point = (e: Edge, t: number) => {
    const [x0, y0, x1, y1, x2, y2, x3, y3] = e.p;
    const u = 1 - t;
    return {
      x: u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
      y: u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
    };
  };

  const setQueue = (i: number) => {
    const b = agents[i]!.querySelector('[data-queue] b');
    if (b) b.textContent = String(queues[i]);
  };

  const setOffline = (off: boolean) => {
    offline = off;
    btn.setAttribute('aria-pressed', String(off));
    label.textContent = off ? '恢复中枢链路' : '模拟断开中枢链路';
    link.classList.toggle('is-off', off);
    linkText.textContent = off ? '链路断开 · 设备本地排队' : '链路正常';
    agents.forEach((a) => a.classList.toggle('is-off', off));
    if (!off) replaying = queues.some((q) => q > 0);
  };
  btn.addEventListener('click', () => setOffline(!offline));

  const draw = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    for (const e of edges) {
      const cut = offline && e.kind === 'up';
      ctx.beginPath();
      ctx.moveTo(e.p[0], e.p[1]);
      ctx.bezierCurveTo(e.p[2], e.p[3], e.p[4], e.p[5], e.p[6], e.p[7]);
      ctx.setLineDash(cut ? [3, 6] : []);
      ctx.strokeStyle = cut ? 'rgba(255,107,91,0.45)' : 'rgba(233,230,223,0.16)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const p of packets) {
      const e = edges[p.edge]!;
      const color = e.kind === 'down' ? TEAL : AMBER;
      for (let k = 0; k < 6; k++) {
        const t = p.t - k * 0.018;
        if (t < 0) break;
        const q = point(e, t);
        ctx.beginPath();
        ctx.arc(q.x, q.y, k === 0 ? 2.6 : 2.2 - k * 0.3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${color},${(1 - k / 6) * (p.replay ? 1 : 0.85)})`;
        ctx.fill();
      }
    }
  };

  let last = performance.now();
  let visible = false;
  let raf = 0;
  const tick = (now: number) => {
    raf = 0;
    // 排队与补传按真实时间推进（「每秒若干样本」），动画位移用截断后的帧间隔，避免掉帧后一跳而过
    const real = Math.min(2, (now - last) / 1000);
    const dt = Math.min(0.05, real);
    last = now;

    agents.forEach((_, i) => {
      nextSpawn[i]! -= real;
      if (nextSpawn[i]! <= 0) {
        nextSpawn[i] = 0.9 + Math.random() * 0.9;
        if (offline) {
          queues[i]!++;
          setQueue(i);
        } else packets.push({ edge: i, t: 0, speed: 0.55 + Math.random() * 0.15, replay: false });
      }
    });
    if (replaying) {
      let any = false;
      queues.forEach((q, i) => {
        if (q > 0 && Math.random() < real * 9) {
          queues[i]!--;
          setQueue(i);
          packets.push({ edge: i, t: 0, speed: 1.1, replay: true });
        }
        if (queues[i]! > 0) any = true;
      });
      replaying = any;
    }
    for (let k = packets.length - 1; k >= 0; k--) {
      const p = packets[k]!;
      p.t += dt * p.speed;
      if (p.t >= 1) {
        packets.splice(k, 1);
        if (edges[p.edge]!.kind === 'up') {
          const c = agents.length + Math.floor(Math.random() * clients.length);
          if (Math.random() < 0.6) packets.push({ edge: c, t: 0, speed: 0.7, replay: false });
        }
      }
    }
    draw();
    if (visible) raf = requestAnimationFrame(tick);
  };

  layout();
  draw();
  new ResizeObserver(() => {
    layout();
    draw();
  }).observe(board);
  if (reduce) return;
  new IntersectionObserver(([en]) => {
    visible = !!en?.isIntersecting;
    if (visible && !raf) {
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }
  }).observe(board);
}
