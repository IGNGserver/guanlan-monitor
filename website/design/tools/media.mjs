// 由 Blender 渲染母版生成站点图片：
//   node design/tools/media.mjs <母版目录>
// 母版目录里需要 hero.png、hero-portrait.png、exploded.png（见 design/blender/build_observatory.py 的 render_masters）。
// 产物：
//   src/assets/renders/{hero,hero-portrait,exploded}.webp   高质量源图，构建时由 Astro 再生成多尺寸 AVIF / WebP
//   public/og/og.png                                         1200×630 社交卡片（用站点自托管字体排版，经 Playwright 截图）
//   public/apple-touch-icon.png                              180×180
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = process.argv[2];
if (!src) {
  console.error('用法：node design/tools/media.mjs <母版目录>');
  process.exit(1);
}

const out = (...p) => path.join(root, ...p);
await mkdir(out('src/assets/renders'), { recursive: true });
await mkdir(out('public/og'), { recursive: true });

for (const name of ['hero', 'hero-portrait', 'exploded']) {
  const file = out('src/assets/renders', `${name}.webp`);
  await sharp(path.join(src, `${name}.png`)).webp({ quality: 90, effort: 6 }).toFile(file);
  console.log('wrote', path.relative(root, file));
}

await sharp(out('public/favicon.svg'), { density: 600 }).resize(180, 180).flatten({ background: '#06080b' }).png().toFile(out('public/apple-touch-icon.png'));
console.log('wrote public/apple-touch-icon.png');

// 社交卡片：左侧文字，右侧首屏渲染
const heroData = (await sharp(path.join(src, 'hero.png')).resize(1600, 900).jpeg({ quality: 88 }).toBuffer()).toString('base64');
const css = (pkg, file = 'index.css') => `<link rel="stylesheet" href="${pathToFileURL(out('node_modules', pkg, file)).href}">`;
const html = `<!doctype html><html><head><meta charset="utf-8">
${css('@fontsource-variable/geist')}${css('@fontsource-variable/geist-mono')}${css('@fontsource-variable/noto-sans-sc', 'wght.css')}<style>
body{margin:0;width:1200px;height:630px;background:#06080b;color:#e9e6df;font-family:'Geist Variable','Noto Sans SC Variable',sans-serif;overflow:hidden;position:relative}
.bg{position:absolute;inset:0;background:url(data:image/jpeg;base64,${heroData}) 62% 50%/cover}
.fade{position:absolute;inset:0;background:linear-gradient(90deg,#06080b 0%,rgba(6,8,11,.92) 30%,rgba(6,8,11,0) 62%)}
.c{position:absolute;left:72px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center}
.e{font-family:'Geist Mono Variable';font-size:16px;letter-spacing:.18em;color:#a9a69e;display:flex;align-items:center;gap:14px}
.e:before{content:'';width:32px;height:1px;background:#ffa64a}
h1{margin:22px 0 18px -6px;font-weight:200;font-size:150px;line-height:1;letter-spacing:-.03em}
p{margin:0;font-size:26px;color:#a9a69e;line-height:1.6}
.m{position:absolute;left:72px;bottom:44px;font-family:'Geist Mono Variable';font-size:15px;color:#75756f;letter-spacing:.12em}
</style></head><body><div class="bg"></div><div class="fade"></div>
<div class="c"><div class="e">GUANLAN · 私有部署</div><h1>观澜</h1><p>电脑与服务器运行状态监控<br>Web · Windows · GNOME Linux · Android</p></div>
<div class="m">CPU · 内存 · 磁盘 · 网络 · 显卡 · 风扇</div></body></html>`;
const tmp = out('node_modules', '.og.html');
await writeFile(tmp, html);
const { chromium } = await import(pathToFileURL(out('node_modules/@playwright/test/index.mjs')).href);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(pathToFileURL(tmp).href);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);
await page.screenshot({ path: out('public/og/og.png') });
await browser.close();
console.log('wrote public/og/og.png', (await readFile(out('public/og/og.png'))).length, 'bytes');
