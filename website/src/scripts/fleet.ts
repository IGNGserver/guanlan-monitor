/**
 * 「舰队与分组」总览驾驶舱示意：
 *  - 按自定义设备组过滤多设备趋势、需关注异常、虚拟化存储池与按日收发流量；
 *  - 真实呈现「离线区间留断口，不画跨停机假直线」与 80% / 90% 阈值虚线。
 */
import {
  FLEET_ATTENTION,
  FLEET_DEVICES,
  FLEET_GROUPS,
  FLEET_POOLS,
  type FleetDeviceDemo,
} from '../data/product';

type GroupId = 'all' | 'pve' | 'build' | 'nas';
type MetricKey = 'cpu' | 'mem' | 'disk';

const LINE_COLORS = ['#ffa64a', '#35d8b6', '#e9e6df', '#9cc4ff', '#f58c6c', '#b7a9ff'];

const BASE_TRAFFIC: [number, number][] = [
  [18.4, 7.2], [21.0, 8.4], [19.6, 6.9], [25.2, 11.1], [32.8, 14.6], [28.1, 10.2], [16.5, 5.8],
  [22.4, 9.1], [24.7, 9.8], [58.6, 26.4], [31.2, 12.0], [20.9, 7.6], [19.1, 7.1], [17.8, 6.4],
  [26.3, 10.8], [29.4, 12.9], [34.1, 15.2], [27.5, 11.0], [23.8, 8.9], [44.2, 19.8], [21.6, 8.2],
  [19.9, 7.5], [24.1, 9.4], [28.7, 11.6], [64.8, 31.2], [35.4, 14.8], [26.9, 10.4], [29.8, 12.1],
  [33.6, 13.7], [48.2, 19.6],
];

const GROUP_SCALE: Record<GroupId, number> = {
  all: 1,
  pve: 0.36,
  build: 0.24,
  nas: 0.4,
};

export function initFleet(): void {
  const root = document.querySelector<HTMLElement>('[data-fleet]');
  if (!root) return;

  const groupBtns = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-group]'));
  const metricBtns = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-fleet-metric]'));
  const eyebrow = root.querySelector<HTMLElement>('[data-fleet-eyebrow]')!;
  const canvas = root.querySelector<HTMLCanvasElement>('[data-fleet-canvas]')!;
  const devStrip = root.querySelector<HTMLElement>('[data-fleet-devices]')!;
  const attList = root.querySelector<HTMLElement>('[data-fleet-attention]')!;
  const attCount = root.querySelector<HTMLElement>('[data-attention-count]')!;
  const poolList = root.querySelector<HTMLElement>('[data-fleet-pools]')!;
  const calCells = root.querySelector<HTMLElement>('[data-cal-cells]')!;
  const calReadout = root.querySelector<HTMLElement>('[data-cal-readout]')!;

  let group: GroupId = 'all';
  let metric: MetricKey = 'cpu';
  let activeDay = BASE_TRAFFIC.length - 1;

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

  function inGroup<T extends { group: 'pve' | 'build' | 'nas' }>(items: T[]): T[] {
    return group === 'all' ? items : items.filter((x) => x.group === group);
  }

  function drawTrends(devices: FleetDeviceDemo[]) {
    if (!w) resize();
    if (!w) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const padL = 36;
    const padR = 12;
    const padT = 10;
    const padB = 22;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const y = (v: number) => padT + (1 - v / 100) * plotH;
    const steps = 12;
    const x = (i: number) => padL + (i / (steps - 1)) * plotW;

    ctx.font = '10px "Geist Mono Variable", ui-monospace, monospace';
    ctx.textBaseline = 'middle';

    for (const g of [0, 50, 100]) {
      ctx.strokeStyle = g === 0 ? 'rgba(233,230,223,0.16)' : 'rgba(233,230,223,0.06)';
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(padL, y(g));
      ctx.lineTo(w - padR, y(g));
      ctx.stroke();
      ctx.fillStyle = 'rgba(233,230,223,0.34)';
      ctx.fillText(`${g}%`, 0, y(g));
    }

    // 80% 提示阈值与 90% 严重阈值虚线
    for (const [th, color] of [
      [80, 'rgba(255,166,74,0.38)'],
      [90, 'rgba(255,93,93,0.42)'],
    ] as const) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(padL, y(th));
      ctx.lineTo(w - padR, y(th));
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = color;
      ctx.fillText(`${th}%`, 0, y(th));
    }

    ctx.fillStyle = 'rgba(233,230,223,0.32)';
    ctx.fillText('−6 小时', padL, h - 7);
    const nowTxt = '现在';
    ctx.fillText(nowTxt, w - padR - ctx.measureText(nowTxt).width, h - 7);

    devices.forEach((dev, di) => {
      const vals = dev[metric];
      const col = LINE_COLORS[di % LINE_COLORS.length]!;
      ctx.strokeStyle = col;
      ctx.lineWidth = dev.health === 'amber' || !dev.online ? 1.8 : 1.35;
      ctx.lineJoin = 'round';
      ctx.setLineDash([]);

      let open = false;
      ctx.beginPath();
      vals.forEach((v, i) => {
        if (v === null) {
          open = false;
          return;
        }
        if (!open) {
          ctx.moveTo(x(i), y(v));
          open = true;
        } else {
          ctx.lineTo(x(i), y(v));
        }
      });
      ctx.stroke();

      // 在离线断口起点与恢复点画空心端点，直观标示「离线留空断口」
      vals.forEach((v, i) => {
        if (v === null) return;
        const prevNull = i > 0 && vals[i - 1] === null;
        const nextNull = i < vals.length - 1 && vals[i + 1] === null;
        if (prevNull || nextNull || i === vals.length - 1) {
          ctx.beginPath();
          ctx.arc(x(i), y(v), 2.5, 0, Math.PI * 2);
          ctx.fillStyle = nextNull || prevNull ? '#080b0f' : col;
          ctx.fill();
          ctx.strokeStyle = col;
          ctx.lineWidth = 1.3;
          ctx.stroke();
        }
      });

      if (!dev.online) {
        const gapX = (x(4) + x(7)) * 0.5;
        const gapY = y(58);
        ctx.fillStyle = 'rgba(233,230,223,0.52)';
        const label = '离线断口';
        ctx.fillText(label, gapX - ctx.measureText(label).width * 0.5, gapY);
      }
    });
  }

  function renderCalendar() {
    const scale = GROUP_SCALE[group];
    const maxSum = Math.max(...BASE_TRAFFIC.map(([r, t]) => (r + t) * scale));
    calCells.innerHTML = BASE_TRAFFIC.map(([rx, tx], idx) => {
      const sum = (rx + tx) * scale;
      const pct = Math.max(10, Math.round((sum / maxSum) * 100));
      const peak = rx + tx > 70;
      const dayLabel = `D-${29 - idx}`;
      return `<button type="button" data-cal-day="${idx}" class="${peak ? 'is-peak' : ''}" aria-pressed="${idx === activeDay}" aria-label="${dayLabel} 收发流量"><i style="height:${pct}%"></i></button>`;
    }).join('');

    const [rx0, tx0] = BASE_TRAFFIC[activeDay]!;
    const d = new Date(Date.UTC(2026, 10, 14) - (29 - activeDay) * 86_400_000);
    const ds = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    calReadout.textContent = `${ds} · ↓ ${(rx0 * scale).toFixed(1)} GB / ↑ ${(tx0 * scale).toFixed(1)} GB`;
  }

  function render() {
    const gMeta = FLEET_GROUPS.find((g) => g.id === group)!;
    const metricLabel = metric === 'cpu' ? 'CPU 使用率' : metric === 'mem' ? '内存占用' : '磁盘占用';
    eyebrow.textContent = `${gMeta.name} · ${metricLabel}`;

    const devs = inGroup(FLEET_DEVICES);
    drawTrends(devs);

    devStrip.innerHTML = devs
      .map((d, i) => {
        const latest = d[metric].at(-1) ?? null;
        const col = LINE_COLORS[i % LINE_COLORS.length]!;
        return `<span class="dchip ${latest === null ? 'is-off' : ''}"><i class="gdot gdot--${d.health}" style="box-shadow:none;background:${latest === null ? 'var(--bone-3)' : col}"></i><span>${d.name}</span><small>${d.os}</small><b>${latest === null ? '离线' : latest + '%'}</b></span>`;
      })
      .join('');

    const atts = inGroup(FLEET_ATTENTION);
    attCount.textContent = atts.length ? `${atts.length} 项待处理` : '0 项异常';
    attList.innerHTML = atts.length
      ? atts
          .map(
            (a) =>
              `<li><div class="a-top"><span class="a-badge a-badge--${a.severity} mono">${a.badge}</span><strong class="mono">${a.device}</strong><span class="a-age mono">${a.age}</span></div><p class="a-body">${a.detail}</p></li>`,
          )
          .join('')
      : `<li class="a-ok mono">当前分组全部设备运行在阈值之内，无离线或容量告警。</li>`;

    const pools = inGroup(FLEET_POOLS);
    poolList.innerHTML = pools
      .map((p) => {
        const pct = Math.round((p.usedTb / p.totalTb) * 1000) / 10;
        const warn = pct >= 80 || (p.metaPct !== undefined && p.metaPct >= 80);
        return `<li><div class="p-top"><span class="mono">${p.name} <span class="p-kind">· ${p.kind}</span></span><span class="mono">${p.usedTb.toFixed(2)} / ${p.totalTb.toFixed(2)} TB (${pct.toFixed(1)}%)</span></div><div class="p-bar ${warn ? 'is-warn' : ''}"><i style="width:${Math.min(100, pct)}%"></i></div><div class="p-meta mono"><span>宿主机：${p.host}</span>${p.metaPct !== undefined ? `<strong>LVM-thin 元数据 ${p.metaPct.toFixed(1)}%</strong>` : '<span>自动排除 VM 单盘噪声</span>'}</div></li>`;
      })
      .join('');

    renderCalendar();
  }

  groupBtns.forEach((b) =>
    b.addEventListener('click', () => {
      group = (b.dataset.group as GroupId) || 'all';
      groupBtns.forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      render();
    }),
  );

  metricBtns.forEach((b) =>
    b.addEventListener('click', () => {
      metric = (b.dataset.fleetMetric as MetricKey) || 'cpu';
      metricBtns.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      render();
    }),
  );

  calCells.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-cal-day]');
    if (!btn) return;
    activeDay = Number(btn.dataset.calDay);
    renderCalendar();
  });

  calCells.addEventListener('pointerover', (e) => {
    if ((e as PointerEvent).pointerType !== 'mouse') return;
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-cal-day]');
    if (!btn) return;
    activeDay = Number(btn.dataset.calDay);
    renderCalendar();
  });

  window.addEventListener('resize', () => {
    resize();
    drawTrends(inGroup(FLEET_DEVICES));
  });

  resize();
  render();
}
