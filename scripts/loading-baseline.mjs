import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseArgs } from "node:util";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const exec = promisify(execFile);
const separator = "\n__GUANLAN_MEASUREMENT__";
const fields = ["http_code", "http_version", "time_namelookup", "time_connect", "time_appconnect", "time_starttransfer", "time_total", "size_download", "remote_ip"];
const publicHeaders = new Set(["content-encoding", "cache-control", "cf-cache-status", "server-timing", "vary"]);

export function baselineOrigin(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Baseline URLs must be HTTP(S) origins without credentials, paths or queries");
  }
  return url.origin;
}

export function parseMeasurement(stdout, exitCode = 0) {
  const index = stdout.lastIndexOf(separator);
  if (index < 0) return { exitCode, error: "measurement_unavailable" };
  try {
    const raw = JSON.parse(stdout.slice(index + separator.length));
    const headers = {};
    for (const line of stdout.slice(0, index).split(/\r?\n/)) {
      // Redirect/proxy CONNECT headers must not override the final response.
      if (/^HTTP\//.test(line)) { for (const key of Object.keys(headers)) delete headers[key]; }
      const colon = line.indexOf(":");
      const name = line.slice(0, colon).toLowerCase();
      if (colon > 0 && publicHeaders.has(name)) headers[name] = line.slice(colon + 1).trim();
    }
    return { exitCode, ...Object.fromEntries(fields.map((key) => [key, raw[key] ?? null])), headers };
  } catch { return { exitCode, error: "invalid_measurement" }; }
}

export function summarize(samples) {
  const values = samples.filter((sample) => sample.exitCode === 0 && sample.http_code === 200 && Number.isFinite(sample.time_starttransfer))
    .map((sample) => sample.time_starttransfer * 1000).sort((a, b) => a - b);
  const percentile = (p) => values.length ? values[Math.max(0, Math.ceil(values.length * p) - 1)] : null;
  return { successCount: values.length, sampleCount: samples.length, ttfbP50Ms: percentile(0.5), ttfbP75Ms: percentile(0.75) };
}

export async function measureOrigin(origin, timeoutSeconds) {
  const args = ["--compressed", "--silent", "--max-time", String(timeoutSeconds), "--dump-header", "-", "--output", process.platform === "win32" ? "NUL" : "/dev/null", "--write-out", `${separator}%{json}`, `${baselineOrigin(origin)}/`];
  try {
    const { stdout } = await exec("curl", args, { timeout: (timeoutSeconds + 2) * 1000, maxBuffer: 128 * 1024 });
    return parseMeasurement(stdout);
  } catch (error) {
    // Never export stderr, cookies, bodies, access keys or arbitrary curl fields.
    return parseMeasurement(typeof error.stdout === "string" ? error.stdout : "", typeof error.code === "number" ? error.code : -1);
  }
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    samples: { type: "string", default: "5" }, timeout: { type: "string", default: "20" },
    out: { type: "string" }, vantage: { type: "string", default: "unspecified; document proxy/TUN routing separately" }
  } });
  const count = Number(values.samples), timeout = Number(values.timeout);
  if (!positionals.length || !Number.isInteger(count) || count < 1 || count > 20 || !Number.isInteger(timeout) || timeout < 1 || timeout > 30) {
    throw new Error("Usage: pnpm performance:baseline [--samples 1..20] [--timeout 1..30] [--out scratch/report.json] [--vantage label] http(s)://origin ...");
  }
  const origins = positionals.map(baselineOrigin);
  const report = { schema: 1, measuredAt: new Date().toISOString(), vantage: values.vantage,
    scope: "Unauthenticated HTML only; not full application startup or authenticated API latency. System/TUN routing is not detected automatically.", paths: [] };
  for (const origin of origins) {
    const samples = [];
    for (let i = 0; i < count; i++) {
      samples.push(await measureOrigin(origin, timeout));
      if (i + 1 < count) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    report.paths.push({ origin, samples, summary: summarize(samples) });
  }
  const output = JSON.stringify(report, null, 2);
  if (values.out) await writeFile(values.out, `${output}\n`);
  console.log(output);
  if (report.paths.some((path) => path.summary.successCount !== count)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error("Baseline failed: check origin-only URLs, bounded options, curl availability and output path."); process.exitCode = 1; });
}
