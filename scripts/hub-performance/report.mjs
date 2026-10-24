import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function relativeChange(before, after) {
  return typeof before === 'number' && Number.isFinite(before) && before > 0
    && typeof after === 'number' && Number.isFinite(after) ? (after - before) / before * 100 : null;
}

export function comparison(base, head) {
  const failures = [];
  for (const [side, report] of [['base', base], ['head', head]]) {
    if (!report || report.side !== side || report.failures?.length || !report.cleanup || !report.phases?.length) failures.push(`${side}_incomplete`);
  }
  if (base?.harnessSha256 !== head?.harnessSha256) failures.push('different_harness');
  if (base?.phases?.length !== head?.phases?.length) failures.push('different_phase_count');
  const phases = [];
  for (const original of base?.phases ?? []) {
    const candidate = head?.phases?.find((entry) => entry.name === original.name);
    if (!candidate) { failures.push('missing_phase'); continue; }
    const resources = {};
    for (const service of ['web', 'server', 'redis', 'mysql']) {
      const before = original.resources?.[service];
      const after = candidate.resources?.[service];
      if (![before?.cpuNs, after?.cpuNs, before?.sampledMemoryMeanBytes, after?.sampledMemoryMeanBytes]
        .every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0)) failures.push('missing_required_resources');
      resources[service] = {};
      for (const key of ['cpuNs', 'readBytes', 'writeBytes', 'sampledMemoryMeanBytes', 'sampledMemoryMaxBytes']) {
        resources[service][key] = { base: before?.[key] ?? null, head: after?.[key] ?? null,
          changePercent: relativeChange(before?.[key], after?.[key]) };
      }
    }
    phases.push({ name: original.name, resources,
      stackSampledMemoryPeak: { base: original.sampledStackMemoryMaxBytes, head: candidate.sampledStackMemoryMaxBytes,
        changePercent: relativeChange(original.sampledStackMemoryMaxBytes, candidate.sampledStackMemoryMaxBytes) } });
  }
  return { status: failures.length ? 'incomplete' : base?.status === 'complete' && head?.status === 'complete' ? 'complete' : 'partial-resource-evidence',
    failures: [...new Set(failures)], phases };
}

export function markdown(base, head, result = comparison(base, head)) {
  const value = (number) => typeof number === 'number' ? number.toFixed(2) : 'N/A';
  const lines = ['# Hub synthetic resource baseline', '', `Status: **${result.status}**`, '',
    `Base: \`${base?.sha ?? 'missing'}\``, `Head: \`${head?.sha ?? 'missing'}\``, '',
    'One sequential CI smoke per revision. Descriptive measurements only; no statistical significance,',
    'production claim, performance pass/fail threshold, live-view benchmark or long-soak claim.',
    'Missing block-IO counters are unavailable, not zero. Memory peaks are sampled cgroup usage.', '',
    '| Phase | Service | CPU ns base | CPU ns head | Change % | Mean memory base (B) | Mean memory head (B) | Change % |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |'];
  for (const phase of result.phases) for (const [service, metrics] of Object.entries(phase.resources)) {
    lines.push(`| ${phase.name} | ${service} | ${value(metrics.cpuNs.base)} | ${value(metrics.cpuNs.head)} | ${value(metrics.cpuNs.changePercent)} | ${value(metrics.sampledMemoryMeanBytes.base)} | ${value(metrics.sampledMemoryMeanBytes.head)} | ${value(metrics.sampledMemoryMeanBytes.changePercent)} |`);
  }
  if (result.failures.length) lines.push('', `Incomplete: ${result.failures.join(', ')}`);
  lines.push('', 'See JSON for block IO, aligned stack memory peaks, workload counts, latency, failures and cleanup evidence.', '');
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [baseFile, headFile, output] = process.argv.slice(2);
  const load = async (path) => { try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; } };
  const base = await load(baseFile), head = await load(headFile);
  const result = comparison(base, head);
  await writeFile(output, `${JSON.stringify({ comparison: result, base, head }, null, 2)}\n`);
  const text = markdown(base, head, result);
  await writeFile(`${output}.md`, text);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, text);
  if (result.failures.length) process.exitCode = 1;
}
