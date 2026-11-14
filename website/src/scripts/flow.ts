/**
 * 双模数据流示意：
 *  - telemetry（常规遥测）：Agent → 中枢 → 终端；断开链路时样本在各 Agent 本地排队，恢复后按顺序补传。
 *  - realtime（实时直连）：/api/agent/realtime 出站 WebSocket，中枢下发 challenge / RPC 查询，Agent 回 pong 与快照，
 *    支持演示重装后安装 UUID 冲突与控制台一键重置实时凭据恢复。
 */
interface Packet {
  edge: number;
  t: number;
  dir: 1 | -1;
  speed: number;
  color: string;
  strong: boolean;
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
  const conflictBtn = document.querySelector<HTMLButtonElement>('[data-conflict]');
  const modeBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-flow-mode]'));
  const badge = document.querySelector<HTMLElement>('[data-flow-badge]');
  const hint = document.querySelector<HTMLElement>('[data-flow-hint]');
  if (!board || !canvas || !btn) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const agents = Array.from(board.querySelectorAll<HTMLElement>('.node--agent'));
  const clients = Array.from(board.querySelectorAll<HTMLElement>('.node--client'));
  const hub = board.querySelector<HTMLElement>('.node--hub')!;
  const hubRt = board.querySelector<HTMLElement>('[data-hub-rt]');
  const link = board.querySelector<HTMLElement>('[data-link]')!;
  const linkText = board.querySelector<HTMLElement>('[data-link-text]')!;
  const label = btn.querySelector<HTMLElement>('[data-cut-label]')!;
  const conflictLabel = conflictBtn?.querySelector<HTMLElement>('[data-conflict-label]');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const edges: Edge[] = [
    ...agents.map((a, i) => ({ from: a, to: hub, kind: 'up' as const, agent: i, p: [0, 0, 0, 0, 0, 0, 0, 0] as Edge['p'] })),
    ...clients.map((c) => ({ from: hub, to: c, kind: 'down' as const, p: [0, 0, 0, 0, 0, 0, 0, 0] as Edge['p'] })),
  ];
  const queues = agents.map(() => 0);
  const packets: Packet[] = [];
  const nextSpawn = agents.map(() => Math.random() * 1.2);
  let mode: 'telemetry' | 'realtime' = 'telemetry';
  let offline = false;
  let replaying = false;
  let conflictOnA1 = false;
  let nextRpc = 0.6;
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

  const syncStatusUI = () => {
    if (mode === 'telemetry') {
      link.classList.toggle('is-off', offline);
      linkText.textContent = offline ? '链路断开 · 设备本地排队' : '链路正常 · HTTP 上报';
      agents.forEach((a) => {
        a.classList.toggle('is-off', offline);
        a.classList.remove('is-conflict');
      });
    } else {
      link.classList.toggle('is-off', offline || conflictOnA1);
      linkText.textContent = offline
        ? '连接中断 · 15 秒租约即将失效'
        : conflictOnA1
          ? 'pve-node-01 凭据冲突 · 其余租约正常'
          : '双向实时通道 · 15s 租约有效';
      agents.forEach((a, i) => {
        const isConf = conflictOnA1 && i === 1;
        a.classList.toggle('is-off', offline);
        a.classList.toggle('is-conflict', isConf);
        const leaseEl = a.querySelector<HTMLElement>('[data-lease]');
        if (leaseEl) {
          leaseEl.textContent = offline ? '重连退避' : isConf ? 'UUID 冲突' : '15s 租约';
        }
      });
    }
  };

  const setOffline = (off: boolean) => {
    offline = off;
    btn.setAttribute('aria-pressed', String(off));
    label.textContent = off ? '恢复中枢链路' : '模拟断开中枢链路';
    if (!off && mode === 'telemetry') replaying = queues.some((q) => q > 0);
    syncStatusUI();
  };

  const setConflict = (conf: boolean) => {
    conflictOnA1 = conf;
    conflictBtn?.setAttribute('aria-pressed', String(conf));
    if (conflictLabel) {
      conflictLabel.textContent = conf ? '控制台重置实时凭据（约 30s 恢复）' : '模拟重装 UUID 凭据冲突';
    }
    if (!conf && mode === 'realtime' && !offline) {
      // 重置后立即发一串重登记握手粒子
      packets.push({ edge: 1, t: 0, dir: 1, speed: 1.15, color: TEAL, strong: true });
    }
    syncStatusUI();
  };

  const setMode = (next: 'telemetry' | 'realtime') => {
    mode = next;
    board.dataset.mode = next;
    packets.length = 0;
    modeBtns.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.flowMode === next)));
    agents.forEach((a) => {
      const q = a.querySelector<HTMLElement>('[data-queue]');
      const l = a.querySelector<HTMLElement>('[data-lease]');
      if (q) q.hidden = next === 'realtime';
      if (l) l.hidden = next !== 'realtime';
    });
    if (hubRt) hubRt.hidden = next !== 'realtime';
    if (conflictBtn) conflictBtn.hidden = next !== 'realtime';
    if (badge) {
      badge.textContent = next === 'realtime' ? '示意数据 · /api/agent/realtime 双向通道' : '示意数据 · 持久上报通道';
    }
    if (hint) {
      hint.textContent =
        next === 'realtime'
          ? '示意动画：观看者发起查询 → 中枢经活跃 WebSocket 下发请求（5s 内 ACK + schema 校验）→ 900ms 内共享同一快照，不写历史库。'
          : '示意动画：断开后样本在设备本地排队，恢复后按顺序补传；无法恢复的样本会被隔离，不阻塞队列。';
    }
    layout();
    syncStatusUI();
    draw();
  };

  btn.addEventListener('click', () => setOffline(!offline));
  conflictBtn?.addEventListener('click', () => setConflict(!conflictOnA1));
  modeBtns.forEach((b) =>
    b.addEventListener('click', () => {
      const target = b.dataset.flowMode === 'realtime' ? 'realtime' : 'telemetry';
      setMode(target);
    }),
  );

  const draw = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    for (const e of edges) {
      const isAgentConflict = mode === 'realtime' && conflictOnA1 && e.kind === 'up' && e.agent === 1;
      const cut = (offline && e.kind === 'up') || isAgentConflict;
      ctx.beginPath();
      ctx.moveTo(e.p[0], e.p[1]);
      ctx.bezierCurveTo(e.p[2], e.p[3], e.p[4], e.p[5], e.p[6], e.p[7]);
      ctx.setLineDash(cut ? [3, 6] : []);
      ctx.strokeStyle = cut
        ? 'rgba(255,107,91,0.5)'
        : mode === 'realtime'
          ? 'rgba(53,216,182,0.22)'
          : 'rgba(233,230,223,0.16)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const p of packets) {
      const e = edges[p.edge]!;
      for (let k = 0; k < 6; k++) {
        const t = p.t - p.dir * k * 0.018;
        if (t < 0 || t > 1) continue;
        const q = point(e, t);
        ctx.beginPath();
        ctx.arc(q.x, q.y, k === 0 ? 2.7 : 2.2 - k * 0.3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.color},${(1 - k / 6) * (p.strong ? 1 : 0.85)})`;
        ctx.fill();
      }
    }
  };

  let last = performance.now();
  let visible = false;
  let raf = 0;
  const tick = (now: number) => {
    raf = 0;
    const real = Math.min(2, (now - last) / 1000);
    const dt = Math.min(0.05, real);
    last = now;

    if (mode === 'telemetry') {
      agents.forEach((_, i) => {
        nextSpawn[i]! -= real;
        if (nextSpawn[i]! <= 0) {
          nextSpawn[i] = 0.9 + Math.random() * 0.9;
          if (offline) {
            queues[i]!++;
            setQueue(i);
          } else {
            packets.push({ edge: i, t: 0, dir: 1, speed: 0.55 + Math.random() * 0.15, color: AMBER, strong: false });
          }
        }
      });
      if (replaying) {
        let any = false;
        queues.forEach((q, i) => {
          if (q > 0 && Math.random() < real * 9) {
            queues[i]!--;
            setQueue(i);
            packets.push({ edge: i, t: 0, dir: 1, speed: 1.1, color: AMBER, strong: true });
          }
          if (queues[i]! > 0) any = true;
        });
        replaying = any;
      }
    } else {
      // 实时模式：中枢每 5s 向在线 Agent 下发 challenge（dir=-1），Agent 回 pong（dir=1）；观看者按需发起 RPC 查询
      agents.forEach((_, i) => {
        nextSpawn[i]! -= real;
        if (nextSpawn[i]! <= 0) {
          nextSpawn[i] = 1.2 + Math.random() * 0.9;
          if (!offline && !(conflictOnA1 && i === 1)) {
            packets.push({ edge: i, t: 1, dir: -1, speed: 0.95, color: TEAL, strong: false });
          }
        }
      });
      nextRpc -= real;
      if (nextRpc <= 0) {
        nextRpc = 1.05;
        const cIdx = agents.length + Math.floor(Math.random() * clients.length);
        // 终端 → 中枢 查询请求（dir=-1，在 down 边上从终端飞向中枢）
        packets.push({ edge: cIdx, t: 1, dir: -1, speed: 1.05, color: AMBER, strong: true });
      }
    }

    for (let k = packets.length - 1; k >= 0; k--) {
      const p = packets[k]!;
      p.t += dt * p.speed * p.dir;
      if (p.t >= 1 || p.t <= 0) {
        const finished = packets.splice(k, 1)[0]!;
        const e = edges[finished.edge]!;
        if (mode === 'telemetry') {
          if (e.kind === 'up' && finished.dir === 1) {
            const c = agents.length + Math.floor(Math.random() * clients.length);
            if (Math.random() < 0.6) packets.push({ edge: c, t: 0, dir: 1, speed: 0.7, color: TEAL, strong: false });
          }
        } else if (!offline) {
          if (e.kind === 'up' && finished.dir === -1 && !(conflictOnA1 && e.agent === 1)) {
            // Agent 收到中枢 challenge 或 RPC 后立即回传 pong / 结果
            packets.push({ edge: finished.edge, t: 0, dir: 1, speed: 1.1, color: finished.color, strong: finished.strong });
          } else if (e.kind === 'down' && finished.dir === -1) {
            // 中枢收到观看者查询 → 挑一台正常 Agent 下发实时采样请求
            const candidates = [0, 1, 2, 3].filter((idx) => !(conflictOnA1 && idx === 1));
            const targetAgent = candidates[Math.floor(Math.random() * candidates.length)] ?? 0;
            packets.push({ edge: targetAgent, t: 1, dir: -1, speed: 1.2, color: AMBER, strong: true });
          } else if (e.kind === 'up' && finished.dir === 1 && finished.color === AMBER) {
            // 900ms 会话合并：一次采样结果分发给多个正在观看的终端
            clients.forEach((_, ci) => {
              if (Math.random() < 0.75) {
                packets.push({ edge: agents.length + ci, t: 0, dir: 1, speed: 1.0, color: TEAL, strong: true });
              }
            });
          }
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
