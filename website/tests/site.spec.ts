import { expect, test, type Page } from '@playwright/test';

const PAGES = ['/', '/download/', '/deploy/'];

/** 收集页面错误与 console.error（忽略 SwiftShader 的驱动性能提示）。 */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/GL Driver|GPU stall/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

/**
 * 不涉及 3D 的交互测试关掉 WebGL：软件渲染（SwiftShader）会长时间占住主线程，
 * 多个页面并行时会把 DOM 交互拖到超时。关掉后页面走 no-gl 路径，这些交互本身不受影响。
 */
async function withoutWebGL(page: Page) {
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (/webgl/.test(type)) return null;
      return (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof orig;
  });
}

test.describe('首页 · 3D', () => {
  test.describe.configure({ mode: 'serial' });

  test('首屏、导航与 3D 场景启动', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: '观澜' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
    // 场景在空闲时加载；软件渲染较慢，给足时间
    await expect(page.locator('html')).toHaveClass(/gl-live/, { timeout: 60_000 });
    await expect(page.locator('[data-stage]')).toHaveClass(/is-live/);
    const drawn = await page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>('[data-stage] canvas')!;
      return c.width > 0 && c.height > 0;
    });
    expect(drawn).toBe(true);
    expect(errors).toEqual([]);
  });

  test('剖面：滚动逐层聚焦，层级导航可跳转', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/gl-live/, { timeout: 60_000 });
    const ana = page.locator('#anatomy');
    const go = (p: number) =>
      page.evaluate((v) => {
        const el = document.getElementById('anatomy')!;
        window.scrollTo(0, el.offsetTop + v * (el.offsetHeight - innerHeight));
      }, p);
    await go(0.5);
    // 软件 WebGL 会长时间占住主线程，断言放宽时限
    await expect(ana).toHaveClass(/is-stepping/, { timeout: 20_000 });
    await expect(page.locator('[data-step].is-active')).toHaveCount(1);
    await page.locator('[data-rail="6"]').click();
    await expect(page.locator('[data-step="6"]')).toHaveClass(/is-active/, { timeout: 10_000 });
    await expect(page.locator('[data-step="6"] h3')).toHaveText('网络');
  });

});

test.describe('首页 · 交互', () => {
  test.beforeEach(({ page }) => withoutWebGL(page));

  test('数据流：断开链路时本地排队，恢复后补传', async ({ page }) => {
    await page.goto('/#flow');
    await expect(page.locator('html')).toHaveClass(/no-gl/);
    const cut = page.locator('[data-cut]');
    await cut.scrollIntoViewIfNeeded();
    await cut.click();
    await expect(cut).toHaveAttribute('aria-pressed', 'true');
    await expect
      .poll(async () => (await page.locator('[data-queue] b').allTextContents()).reduce((a, b) => a + Number(b), 0), { timeout: 20_000 })
      .toBeGreaterThan(2);
    await cut.click();
    await expect
      .poll(async () => (await page.locator('[data-queue] b').allTextContents()).reduce((a, b) => a + Number(b), 0), { timeout: 25_000 })
      .toBe(0);
  });

  test('实时面板：间隔、标签页、排序与过期提示', async ({ page }) => {
    await page.goto('/#live');
    const live = page.locator('[data-live]');
    await live.scrollIntoViewIfNeeded();
    await page.locator('[data-interval="2"]').click();
    await expect(page.locator('[data-interval="2"]')).toHaveAttribute('aria-checked', 'true');

    await page.getByRole('tab', { name: '进程' }).click();
    await expect(page.locator('#pane-proc')).toBeVisible();
    await page.locator('[data-sort="gpu"]').click();
    const firstGpu = await page.locator('[data-proc] tr').first().locator('td').nth(4).textContent();
    expect(firstGpu).toMatch(/%$/);
    const lastGpu = await page.locator('[data-proc] tr').last().locator('td').nth(4).textContent();
    expect(lastGpu).toBe('—'); // 未知值排在已知值之后

    await page.getByRole('tab', { name: '容器' }).click();
    await expect(page.locator('[data-docker] tr')).toHaveCount(6);

    await page.locator('[data-fail]').click();
    await expect(page.locator('[data-pill]')).toHaveAttribute('data-state', /stale|gone/, { timeout: 8_000 });
    await expect(page.locator('[data-pill]')).toHaveAttribute('data-state', 'gone', { timeout: 12_000 });
    await expect(page.locator('[data-pill]')).toHaveAttribute('data-state', 'live', { timeout: 20_000 });
  });

  test('收尾下载按钮直链到产品仓库的 Release 资产', async ({ page }) => {
    await page.goto('/');
    const picks = page.locator('[data-picks] a');
    await expect(picks).toHaveCount(3);
    for (const href of await picks.evaluateAll((els) => els.map((e) => e.getAttribute('href')))) {
      expect(href).toMatch(/^https:\/\/github\.com\/IGNGserver\/guanlan-monitor\/releases\//);
    }
  });
});

test.describe('减少动态', () => {
  test.use({ reducedMotion: 'reduce' });

  test('不启动 WebGL，显示静帧与全部层级', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/no-gl/);
    await expect(page.locator('.stage__poster img')).toBeVisible();
    await expect(page.locator('[data-step].is-active')).toHaveCount(7);
    await expect(page.locator('.ana__static img')).toBeVisible();
  });
});

test.describe('子页面', () => {
  test.beforeEach(({ page }) => withoutWebGL(page));

  test('下载页：每个资产都有直链与 .sha256', async ({ page }) => {
    await page.goto('/download/');
    await expect(page.getByRole('heading', { level: 1, name: '下载观澜' })).toBeVisible();
    const assets = page.locator('.asset');
    await expect(assets).toHaveCount(5);
    const links = await page.locator('.asset__act a').evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
    expect(links.filter((l) => l.endsWith('.sha256'))).toHaveLength(5);
    for (const l of links) expect(l).toMatch(/^https:\/\/github\.com\/IGNGserver\/guanlan-monitor\/releases\//);
  });

  test('部署页：关键配置项与 WebSocket 路径', async ({ page }) => {
    await page.goto('/deploy/');
    for (const k of ['SESSION_SECRET', 'ACCESS_KEY', 'MYSQL_ROOT_PASSWORD', 'MYSQL_PASSWORD', 'REDIS_PASSWORD']) {
      await expect(page.locator('.envt').getByText(k, { exact: true })).toBeVisible();
    }
    await expect(page.getByText('/api/agent/realtime')).toBeVisible();
  });

  test('404 页', async ({ page }) => {
    const res = await page.goto('/no-such-page/');
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('这里没有可观测的东西。');
  });

  test('站内链接全部可达', async ({ page, request }) => {
    const seen = new Set<string>();
    for (const p of PAGES) {
      await page.goto(p);
      const hrefs = await page.locator('a[href^="/"]').evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).pathname));
      hrefs.forEach((h) => seen.add(h));
    }
    for (const h of seen) {
      const res = await request.get(h);
      expect(res.status(), h).toBe(200);
    }
  });
});

test.describe('手机', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
  test.beforeEach(({ page }) => withoutWebGL(page));

  for (const p of PAGES) {
    test(`无横向溢出 ${p}`, async ({ page }) => {
      await page.goto(p);
      await page.waitForTimeout(500);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test('菜单可展开与关闭', async ({ page }) => {
    await page.goto('/');
    const btn = page.locator('[data-menu]');
    await btn.click();
    await expect(page.locator('#nav-sheet')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#nav-sheet')).toBeHidden();
  });
});
