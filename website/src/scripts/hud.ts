/**
 * 首屏 HUD 的示意读数：每秒刷新一次，保留最近 40 个点画迷你曲线。
 * 数值是演示用的平滑随机游走，面板上明确标注「示意数据」。时钟是访客本地时间。
 */
const SPECS: Record<string, { base: number; amp: number; min: number; max: number; digits: number }> = {
  cpu: { base: 23, amp: 6, min: 3, max: 96, digits: 1 },
  mem: { base: 61, amp: 1.2, min: 40, max: 90, digits: 1 },
  net: { base: 4.8, amp: 1.6, min: 0.2, max: 40, digits: 2 },
  fan: { base: 1180, amp: 40, min: 600, max: 2600, digits: 0 },
};

export function initHud(): void {
  const clock = document.querySelector<HTMLElement>('[data-clock]');
  const series = new Map<string, number[]>();
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  for (const [k, s] of Object.entries(SPECS)) {
    const arr: number[] = [];
    let v = s.base;
    for (let i = 0; i < 40; i++) {
      v = step(v, s, i);
      arr.push(v);
    }
    series.set(k, arr);
  }

  let tick = 40;
  const draw = () => {
    for (const [k, s] of Object.entries(SPECS)) {
      const arr = series.get(k)!;
      const out = document.querySelector<HTMLElement>(`[data-readout="${k}"]`);
      const line = document.querySelector<SVGPolylineElement>(`[data-spark="${k}"]`);
      if (out) out.textContent = arr.at(-1)!.toFixed(s.digits);
      if (line) {
        const lo = Math.min(...arr);
        const hi = Math.max(...arr);
        const span = hi - lo || 1;
        line.setAttribute(
          'points',
          arr.map((v, i) => `${((i / (arr.length - 1)) * 100).toFixed(1)},${(18 - ((v - lo) / span) * 16).toFixed(1)}`).join(' '),
        );
      }
    }
    if (clock) clock.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  };

  draw();
  if (reduce) return;
  setInterval(() => {
    if (document.hidden) return;
    tick++;
    for (const [k, s] of Object.entries(SPECS)) {
      const arr = series.get(k)!;
      arr.push(step(arr.at(-1)!, s, tick));
      arr.shift();
    }
    draw();
  }, 1000);
}

function step(v: number, s: { base: number; amp: number; min: number; max: number }, i: number): number {
  const drift = (s.base - v) * 0.12;
  const wave = Math.sin(i * 0.31) * s.amp * 0.25;
  const noise = (Math.random() - 0.5) * s.amp;
  return Math.min(s.max, Math.max(s.min, v + drift + noise * 0.6 + wave * 0.2));
}
