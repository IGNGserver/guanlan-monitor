/**
 * 滚动导演：把页面滚动位置翻译成 StageState，交给 Observatory 渲染。
 *
 *   #hero      组装态，悬在海面之上；向下滚动时拉远、剖开
 *   #anatomy   粘性区段，自上而下逐层聚焦（观测窗 → 网络）
 *   中间各节    舞台淡出并停止渲染
 *   #get       收尾：俯视观测窗，舞台重新出现
 *
 * 先上屏的是 Blender 渲染静帧；three 与模型在空闲时加载，任何失败都停在静帧上。
 * prefers-reduced-motion 或不支持 WebGL 时不启动场景（html.no-gl）。
 */
import type { Observatory, StageState } from './scene';
import { layerCenter, SPEC } from './spec';

const N = SPEC.layers.length;
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function mixState(a: StageState, b: StageState, t: number): StageState {
  const o = {} as StageState;
  for (const k of Object.keys(a) as (keyof StageState)[]) o[k] = mix(a[k], b[k], t);
  return o;
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export function boot(): void {
  const root = document.documentElement;
  const stage = document.querySelector<HTMLElement>('[data-stage]');
  const canvas = stage?.querySelector<HTMLCanvasElement>('canvas');
  if (!stage || !canvas) return;

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !webglAvailable()) {
    root.classList.add('no-gl');
    initStaticAnatomy();
    return;
  }

  trackSteps();

  const coarse = matchMedia('(pointer: coarse)').matches;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const low = coarse || (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4;

  const start = () =>
    import('./scene')
      .then(async ({ Observatory }) => {
        const obs = new Observatory(canvas, { low });
        await obs.load('/models/observatory.glb');
        run(obs, stage);
      })
      .catch((err) => {
        console.warn('[observatory] 场景未能启动，保留静帧：', err);
        root.classList.add('no-gl');
        initStaticAnatomy();
      });

  if ('requestIdleCallback' in window) requestIdleCallback(() => start(), { timeout: 1200 });
  else setTimeout(start, 200);
}

/** 剖面文字面板只依赖滚动位置，与 3D 渲染解耦：场景还没加载好、或在慢设备上，文字也能及时切换。 */
function anatomyStep(): number {
  const ana = document.getElementById('anatomy');
  if (!ana) return -1;
  const r = ana.getBoundingClientRect();
  if (r.top > 0) return -1;
  const p = clamp(-r.top / (r.height - window.innerHeight));
  if (p < 0.06) return -1;
  return Math.min(N - 1, Math.floor(((p - 0.06) / 0.94) * N));
}

function trackSteps() {
  const ana = document.getElementById('anatomy');
  const steps = Array.from(document.querySelectorAll<HTMLElement>('[data-step]'));
  const rail = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-rail]'));
  let active = -2;
  const update = () => {
    const step = anatomyStep();
    if (step === active) return;
    active = step;
    steps.forEach((el, i) => el.classList.toggle('is-active', i === step));
    rail.forEach((el, i) => el.setAttribute('aria-current', String(i === step)));
    ana?.classList.toggle('is-stepping', step >= 0);
  };
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
}

function initStaticAnatomy() {
  document.querySelectorAll('[data-step]').forEach((el) => el.classList.add('is-active'));
}

function run(obs: Observatory, stage: HTMLElement) {
  const hero = document.getElementById('hero');
  const ana = document.getElementById('anatomy');
  const fin = document.getElementById('get');
  const tags = Array.from(document.querySelectorAll<HTMLElement>('[data-tag]'));
  const rail = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-rail]'));
  const lead = document.querySelector<SVGLineElement>('[data-lead]');
  const panel = document.querySelector<HTMLElement>('[data-panel]');

  let vw = window.innerWidth;
  let vh = window.innerHeight;
  let wide = vw >= 900;
  const resize = () => {
    vw = window.innerWidth;
    vh = window.innerHeight;
    wide = vw >= 900;
    obs.resize(stage.clientWidth, stage.clientHeight);
  };
  resize();
  window.addEventListener('resize', resize);

  // 关键帧（与 design/observatory.json 的相机定义对齐）
  const H = SPEC.camera.hero;
  const heroState = (): StageState => ({
    az: H.azimuth,
    el: H.elevation,
    dist: wide ? H.distance : H.distance * 1.12,
    ty: H.target[2],
    explode: 0,
    shiftX: wide ? H.shiftX ?? 0 : 0,
    shiftY: wide ? 0.02 : 0.2,
    sea: 1,
    stream: 1,
    focus: -1,
    ring: 0,
  });
  const overview = (): StageState => ({
    az: -34,
    el: 20,
    dist: wide ? 11.6 : 15.5,
    ty: layerCenter(3, 1),
    explode: 1,
    shiftX: wide ? 0.2 : 0,
    shiftY: wide ? 0 : 0.16,
    sea: 0.25,
    stream: 0,
    focus: -1,
    ring: 0,
  });
  const focusState = (f: number, p: number): StageState => ({
    az: -34 + p * 46,
    el: 15 + 6 * Math.sin(p * Math.PI),
    dist: wide ? 6.4 : 8.6,
    ty: mix(layerCenter(Math.floor(f), 1), layerCenter(Math.min(N - 1, Math.floor(f) + 1), 1), f - Math.floor(f)),
    explode: 1,
    shiftX: wide ? 0.21 : 0,
    shiftY: wide ? 0 : 0.2,
    sea: 0,
    stream: 0,
    focus: f,
    ring: 1,
  });
  const finale = (): StageState => ({
    az: -24,
    el: 52,
    dist: wide ? 5.6 : 8.4,
    ty: 1.0,
    explode: 0,
    shiftX: 0,
    shiftY: wide ? -0.04 : 0.3,
    sea: 0.9,
    stream: 0.7,
    focus: -1,
    ring: 0,
  });

  let current = heroState();
  let last = performance.now();
  let time = 0;
  let frames = 0;
  let slow = 0;
  let degraded = false;
  let running = false;
  let raf = 0;

  const rect = (el: HTMLElement | null) => el?.getBoundingClientRect();

  function targetState(): { state: StageState; opacity: number; overviewT: number } {
    const hr = rect(hero);
    const ar = rect(ana);
    const fr = rect(fin);
    let state = heroState();
    let opacity = 1;
    let overviewT = 0;

    if (hr) {
      const p = clamp(-hr.top / hr.height);
      state = mixState(heroState(), overview(), smooth(0.05, 1, p));
      overviewT = smooth(0.6, 1, p);
    }
    if (ar && ar.top <= 0) {
      const total = ar.height - vh;
      const p = clamp(-ar.top / total);
      // 0–0.06 停留在总览，之后每层占 1/7（与 anatomyStep 同一划分）
      const s = clamp((p - 0.06) / 0.94) * N;
      // 每层停留大半个区间，只在区间末尾 30% 过渡到下一层，与文字切换同步
      const k = Math.min(N - 1, Math.floor(s));
      const f = N - 1 - Math.min(N - 1, k + smooth(0.7, 1, s - k)); // 自上而下
      state = mixState(overview(), focusState(f, p), smooth(0.0, 0.07, p));
      overviewT = 1 - smooth(0.02, 0.07, p);
      opacity = clamp(ar.bottom / vh / 0.55);
    }
    if (fr && fr.top < vh) {
      const t = clamp(1 - fr.top / vh);
      state = finale();
      opacity = smooth(0.15, 0.85, t);
      overviewT = 0;
    }
    return { state, opacity, overviewT };
  }

  function frame(now: number) {
    raf = 0;
    const raw = (now - last) / 1000;
    const dt = Math.min(0.05, raw);
    last = now;
    time += dt;

    const { state, opacity, overviewT } = targetState();
    const k = 1 - Math.exp(-dt * 5.5);
    current = mixState(current, state, k);
    stage.style.opacity = String(opacity);

    if (opacity > 0.002) {
      obs.apply(current, time, dt);
      obs.render();
      placeTags(overviewT);
      // 自适应画质：前 30 帧多数慢于 30fps → 关闭泛光、像素比降到 1；
      // 之后 60 帧仍多数慢于 15fps → 像素比再降到 0.75
      frames++;
      if (raw > (frames <= 30 ? 0.034 : 0.067)) slow++;
      // 单帧超过 250ms：不再等统计，立即降级（软件渲染、极弱的集显）
      if (frames > 2 && raw > 0.25 && !degraded) {
        degraded = true;
        obs.dropBloom();
        obs.setPixelRatio(Math.min(obs.pixelRatio, 0.75));
      }
      if (frames === 30) {
        if (slow > 15) {
          obs.dropBloom();
          if (obs.pixelRatio > 1) obs.setPixelRatio(1);
        }
        slow = 0;
      } else if (frames === 90 && slow > 30) {
        obs.setPixelRatio(0.75);
      }
    }

    if (running) raf = requestAnimationFrame(frame);
  }

  function placeTags(overviewT: number) {
    tags.forEach((el) => {
      const i = Number(el.dataset.tag);
      const a = obs.anchor(i, current);
      el.style.transform = `translate3d(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px, 0)`;
      const focusD = Math.abs(i - current.focus);
      const show = Math.max(overviewT, current.focus >= 0 ? clamp(1 - focusD * 1.6) : 0);
      el.style.opacity = String(show);
      el.classList.toggle('is-focus', current.focus >= 0 && focusD < 0.5);
    });
    if (lead && panel && wide) {
      const i = Math.round(current.focus);
      if (current.focus >= 0 && current.ring > 0.3) {
        const a = obs.anchor(i, current, -1);
        const pr = panel.getBoundingClientRect();
        lead.setAttribute('x1', String(pr.right + 16));
        lead.setAttribute('y1', String(pr.top + 40));
        lead.setAttribute('x2', a.x.toFixed(1));
        lead.setAttribute('y2', a.y.toFixed(1));
        lead.style.opacity = String(clamp(current.ring * (1 - Math.abs(current.focus - i) * 2.5)));
      } else lead.style.opacity = '0';
    }
  }

  const setRunning = (on: boolean) => {
    running = on && !document.hidden;
    if (running && !raf) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };

  // 只有舞台需要出现的区段在视口内时才渲染
  const visible = new Set<Element>();
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) visible.add(e.target);
        else visible.delete(e.target);
      }
      setRunning(visible.size > 0);
      if (visible.size === 0) stage.style.opacity = '0';
    },
    { rootMargin: '10% 0px' },
  );
  [hero, ana, fin].forEach((el) => el && io.observe(el));
  document.addEventListener('visibilitychange', () => setRunning(visible.size > 0));

  rail.forEach((btn, i) =>
    btn.addEventListener('click', () => {
      if (!ana) return;
      const total = ana.offsetHeight - vh;
      const p = 0.06 + ((i + 0.5) / N) * 0.94;
      window.scrollTo({ top: ana.offsetTop + total * p, behavior: 'smooth' });
    }),
  );

  // 第一帧画出来以后再淡入画布，替换静帧
  requestAnimationFrame((t) => {
    last = t;
    frame(t);
    stage.classList.add('is-live');
    document.documentElement.classList.add('gl-live');
  });
}
