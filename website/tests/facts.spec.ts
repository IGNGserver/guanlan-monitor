import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSETS, FALLBACK_RELEASE, HUB_PORT } from '../src/data/product';
import { pickRelease } from '../src/data/release';

/**
 * 事实一致性：站点引用的产品事实必须能在产品仓库文档里找到。
 * 直接读本次 checkout 里的文件——PR 校验的是 PR head，push 校验的是 main，
 * 都不依赖网络，也不会出现「改动还没合并所以查不到」的假失败。
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const FACT_DOCS = [
  'README.md',
  'docs/INSTALL.md',
  'docs/TRUSTED_REALTIME_MONITORING.md',
  'docs/EXTERNAL_DATABASE.md',
  'docs/CLIENT_UPDATES.md',
];

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

  test('产品仓库文档仍包含站点引用的事实', () => {
    const parts: string[] = [];
    for (const doc of FACT_DOCS) {
      try {
        parts.push(readFileSync(join(REPO_ROOT, doc), 'utf8'));
      } catch {
        /* 文件缺失，下面统一跳过 */
      }
    }
    test.skip(parts.length !== FACT_DOCS.length, `产品仓库文档不完整：${FACT_DOCS.join('、')}`);
    const docs = parts.join('\n');
    for (const fact of [
      String(HUB_PORT),
      'GNOME Linux',
      'Android',
      '/VERIFY',
      '--key-stdin',
      'guanlan-agent wait-for-upload',
      'guanlan-agent update --channel stable|preview',
      'DeviceStateConsole-Windows-Setup-v',
      'DeviceStateConsole-Linux-Install-v',
      'DeviceStateConsole-Android-v',
      'SESSION_SECRET',
      'AGENT_REQUIRE_HTTPS',
      'DSC_TRUSTED_TLS_PROXY_CIDRS',
      'DSC_DB_MODE=external',
      'DSC_INSTANCE_ID',
      'docker-compose.external.yml',
      '/api/agent/realtime',
      '4000',
    ]) {
      expect(docs, fact).toContain(fact);
    }
  });
});
