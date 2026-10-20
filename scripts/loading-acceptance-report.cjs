const budgets = { cacheCommittedMs: 1000, interactiveMs: 6000, summaryCommittedMs: 3000 };
function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}
function summarize(samples, fields) {
  const failed = samples.filter((sample) => !sample.ok).length;
  return {
    count: samples.length, succeeded: samples.length - failed, failed,
    metrics: Object.fromEntries(fields.map((field) => {
      const values = samples.filter((s) => s.ok && Number.isFinite(s[field]) && s[field] >= 0).map((s) => s[field]);
      const p75 = percentile(values, 0.75);
      const budgetMs = budgets[field] ?? null;
      return [field, { measured: values.length, p50: percentile(values, 0.5), p75, budgetMs,
        // Incomplete/failed runs can never become a fast PASS.
        status: samples.length < 20 || failed || values.length !== samples.length ? "incomplete" : budgetMs === null ? "observed" : p75 <= budgetMs ? "pass" : "fail" }];
    }))
  };
}
module.exports = { summarize, percentile };
