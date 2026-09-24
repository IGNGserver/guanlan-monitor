// Run only on a GitHub Actions Windows runner against released portable assets.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { _electron: electron } = require('playwright');
const roots = process.argv.slice(2, 4).map((p) => path.resolve(p));
const output = path.resolve(process.argv[4]);

function packageMetrics(root) {
  const asar = fs.readFileSync(path.join(root, 'resources', 'app.asar'));
  const header = JSON.parse(asar.subarray(16, 16 + asar.readUInt32LE(12)).toString());
  const files = [];
  const walk = (node, prefix = '') => {
    for (const [name, entry] of Object.entries(node.files ?? {})) {
      const key = `${prefix}${name}`;
      if (entry.files) walk(entry, `${key}/`);
      else files.push({ path: key, bytes: entry.size ?? 0 });
    }
  };
  walk(header);
  const bytes = (predicate) => files.filter(predicate).reduce((sum, item) => sum + item.bytes, 0);
  const diskBytes = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => {
    const full = path.join(dir, entry.name);
    return sum + (entry.isDirectory() ? diskBytes(full) : fs.statSync(full).size);
  }, 0);
  return {
    unpackedBytes: diskBytes(root), asarBytes: asar.length,
    nodeModulesBytes: bytes((f) => f.path.startsWith('node_modules/')),
    sourceMapBytes: bytes((f) => f.path.endsWith('.map')),
    rendererJavaScriptBytes: bytes((f) => f.path.startsWith('dist/renderer/') && f.path.endsWith('.js')),
    files: files.length
  };
}

async function measure(root, iteration) {
  const executable = fs.readdirSync(root).find((name) => name.endsWith('.exe') && !name.startsWith('Uninstall'));
  assert.ok(executable, `Missing executable in ${root}`);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'guanlan-perf-'));
  const errors = [];
  let app;
  const start = performance.now();
  try {
    app = await electron.launch({ executablePath: path.join(root, executable),
      args: [`--user-data-dir=${userData}`],
      env: { ...process.env, NODE_ENV: 'test', DSC_VISUAL_FIXTURE: '1' }
    });
    const page = await app.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.locator('.workspace-page--overview').waitFor({ state: 'visible', timeout: 30_000 });
    const startupMs = performance.now() - start;
    const initialJs = await page.evaluate(() => performance.getEntriesByType('resource').filter((r) => /\.js(?:\?|$)/.test(r.name)).map((r) => ({ name: r.name.split('/').at(-1), bytes: r.decodedBodySize })));
    // Let the async session probe and startup work settle on both versions.
    await page.waitForTimeout(2000);
    const profileStart = performance.now();
    await page.evaluate(async () => { for (let i = 0; i < 20; i++) await window.dsc.getRuntimeProfile(); });
    const profile20CallsMs = performance.now() - profileStart;
    const samples = async () => {
      const result = [];
      for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        result.push(await app.evaluate(({ app }) => app.getAppMetrics().map((m) => ({ type: m.type, cpu: m.cpu.percentCPUUsage, memory: m.memory }))));
      }
      return result;
    };
    const visible = await samples();
    const heap = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
    const hidden = await samples();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
    await page.locator('.workspace-page--overview').waitFor({ state: 'visible' });
    await page.evaluate(() => { location.hash = '#device/visual-vm'; });
    await page.locator('.workspace-page--device').waitFor({ state: 'visible' });
    assert.deepEqual(errors, []);
    return { iteration, startupMs, profile20CallsMs, initialJs, rendererHeapBytes: heap, visible, hidden, errors };
  } finally {
    if (app) await app.close();
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}

(async () => {
  const result = { measuredAt: new Date().toISOString(), runner: { platform: process.platform, release: os.release(), cpus: os.cpus().length },
    limitations: 'Three alternating launches with fresh app data; OS file cache is warm. Fixture GUI only; excludes real Hub, Agent and hardware probes. Working-set sums can double-count shared pages. CPU and timing are observations, not production guarantees.',
    before: { package: packageMetrics(roots[0]), runs: [] }, after: { package: packageMetrics(roots[1]), runs: [] } };
  for (let iteration = 0; iteration < 3; iteration++) {
    for (const side of iteration % 2 ? [1, 0] : [0, 1]) {
      const key = side ? 'after' : 'before';
      result[key].runs.push(await measure(roots[side], iteration));
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, JSON.stringify(result, null, 2));
      console.log(`${key} iteration ${iteration} completed`);
    }
  }
  assert.equal(result.after.package.nodeModulesBytes, 0, 'Vite-bundled renderer dependencies must not be duplicated');
  assert.equal(result.after.package.sourceMapBytes, 0, 'source maps must remain in CI build output only');
  assert.ok(result.after.package.asarBytes < result.before.package.asarBytes);
  console.log(JSON.stringify({ before: result.before.package, after: result.after.package }, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
