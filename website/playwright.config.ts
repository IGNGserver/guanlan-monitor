import { defineConfig, devices } from '@playwright/test';

/**
 * 端到端检查：对 `astro build` 的产物起 `astro preview`，在 Chromium 里跑。
 * 软件 WebGL（SwiftShader）保证在无 GPU 的 CI / 虚拟机上也能真正渲染 3D 场景。
 */
const PORT = Number(process.env.PREVIEW_PORT) || 4322;

export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices['Desktop Chrome'],
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  webServer: {
    // Astro 7 在任意 AI agent 环境下默认把 preview 转入后台；--ignore-lock 显式切回一次性前台服务（withastro/astro#17903）。
    command: `pnpm exec astro preview --ignore-lock --port ${PORT} --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI && !process.env.PREVIEW_PORT,
    timeout: 60_000,
  },
});
