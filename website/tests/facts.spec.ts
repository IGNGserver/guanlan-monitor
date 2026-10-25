import { expect, test } from '@playwright/test';
import { ASSETS, FALLBACK_RELEASE, HUB_PORT, REPO } from '../src/data/product';
import { pickRelease } from '../src/data/release';

/**
 * 事实一致性：站点引用的产品事实必须能在产品仓库 README 里找到。
 * 需要网络；拿不到 README 时跳过（离线构建机），CI 上会真正执行。
 */
test.describe('产品事实', () => {
  test('烘焙的发布信息符合资产命名规则', () => {
    for (const spec of ASSETS) {
      const a = FALLBACK_RELEASE.assets[spec.key];
      expect(a, spec.key).toBeTruthy();
      expect(a!.name).toMatch(spec.pattern);
      expect(a!.name).toContain(FALLBACK_RELEASE.tag);
    }
  });

  test('pickRelease 跳过 draft 与旧命名的发布', () => {
    const asset = (name: string) => ({ name, browser_download_url: `https://example.invalid/${name}`, size: 1 });
    const picked = pickRelease([
      { tag_name: 'v9', html_url: '', published_at: '', draft: true, prerelease: false, assets: [] },
      {
        tag_name: 'v0.2.271',
        html_url: '',
        published_at: '',
        draft: false,
        prerelease: false,
        assets: [asset('DeviceStateConsole-Windows-GUI-Setup-v0.2.271.exe')],
      },
      {
        tag_name: 'v3.0.1',
        html_url: 'u',
        published_at: '2026-01-01T00:00:00Z',
        draft: false,
        prerelease: true,
        assets: [
          asset('DeviceStateConsole-Windows-Setup-v3.0.1.exe'),
          asset('DeviceStateConsole-Linux-Install-v3.0.1.deb'),
          asset('DeviceStateConsole-Android-v3.0.1.apk'),
        ],
      },
    ]);
    expect(picked?.tag).toBe('v3.0.1');
    expect(picked?.prerelease).toBe(true);
    expect(picked?.url).toBe('https://github.com/IGNGserver/guanlan-monitor/releases/tag/v3.0.1');
    expect(picked?.assets.winSetup?.url).toBe(
      'https://github.com/IGNGserver/guanlan-monitor/releases/download/v3.0.1/DeviceStateConsole-Windows-Setup-v3.0.1.exe',
    );
  });

  test('README 仍包含站点引用的事实', async ({ request }) => {
    let readme = '';
    try {
      const res = await request.get(`https://raw.githubusercontent.com/${REPO}/main/README.md`, { timeout: 10_000 });
      if (res.ok()) readme = await res.text();
    } catch {
      /* 离线 */
    }
    test.skip(!readme, '无法读取产品 README（离线）');
    for (const fact of [
      String(HUB_PORT),
      'GNOME Linux',
      'Android',
      '/VERIFY',
      '--key-stdin',
      'guanlan-agent wait-for-upload',
      'DeviceStateConsole-Windows-Setup-v',
      'DeviceStateConsole-Linux-Install-v',
      'DeviceStateConsole-Android-v',
      'SESSION_SECRET',
      'AGENT_REQUIRE_HTTPS',
      '4000',
    ]) {
      expect(readme, fact).toContain(fact);
    }
  });
});
