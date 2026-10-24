import assert from 'node:assert/strict';
import test from 'node:test';
import { stackTotals } from './report.mjs';

test('whole-stack totals include all services and never sum independent memory peaks', () => {
  const phase = { sampledStackMemoryMaxBytes: 200, resources: Object.fromEntries(
    ['web', 'server', 'redis', 'mysql'].map((key, index) => [key, {
      cpuNs: index, readBytes: index, writeBytes: index, sampledMemoryMeanBytes: 40, sampledMemoryMaxBytes: 100
    }])) };
  assert.deepEqual(stackTotals(phase), { cpuNs: 6, readBytes: 6, writeBytes: 6,
    sampledMemoryMeanBytes: 160, sampledMemoryMaxBytes: 200 });
  phase.resources.server.readBytes = null;
  phase.resources.mysql.writeBytes = undefined;
  assert.equal(stackTotals(phase).readBytes, null);
  assert.equal(stackTotals(phase).writeBytes, null);
  assert.equal(stackTotals(phase).cpuNs, 6);
  assert.equal(stackTotals(null).cpuNs, null);
});
