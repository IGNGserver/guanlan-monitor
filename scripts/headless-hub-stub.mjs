#!/usr/bin/env node
/**
 * Minimal Hub stub for headless acceptance tests.
 *
 * It accepts the three endpoints an installed agent talks to, records the first
 * accepted ingest payload to a marker file, and can wait for that marker. CI uses
 * it to prove that a machine with no desktop session really installs, configures,
 * starts at boot and reports.
 *
 * Usage:
 *   node scripts/headless-hub-stub.mjs serve --port 3199 --marker /tmp/ingest.json [--key KEY]
 *   node scripts/headless-hub-stub.mjs wait  --marker /tmp/ingest.json --timeout 120
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

function parseArguments(argv) {
  const options = { command: argv[0] ?? "serve", port: 3199, marker: "", key: "", timeout: 120 };
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--port") options.port = Number(value);
    else if (flag === "--marker") options.marker = value;
    else if (flag === "--key") options.key = value;
    else if (flag === "--timeout") options.timeout = Number(value);
    else continue;
    index += 1;
  }
  return options;
}

const options = parseArguments(process.argv.slice(2));

if (options.command === "wait") {
  const deadline = Date.now() + options.timeout * 1000;
  while (Date.now() < deadline) {
    if (options.marker && fs.existsSync(options.marker)) {
      console.log(`headless-hub-stub: observed an ingest at ${fs.readFileSync(options.marker, "utf8").slice(0, 200)}`);
      process.exit(0);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  console.error(`headless-hub-stub: no ingest arrived within ${options.timeout}s`);
  process.exit(1);
}

let ingested = 0;
const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${options.port}`);

  if (request.method === "GET" && url.pathname === "/api/agent/ping") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true, serverTime: new Date().toISOString() }));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/agent/device-state") {
    const authorization = request.headers.authorization ?? "";
    if (options.key && authorization !== `Bearer ${options.key}`) {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ deviceId: "ci-headless", metrics: null }));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/agent/ingest") {
    const authorization = request.headers.authorization ?? "";
    if (options.key && authorization !== `Bearer ${options.key}`) {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      ingested += 1;
      const body = Buffer.concat(chunks).toString("utf8");
      let summary = {};
      try {
        const payload = JSON.parse(body);
        summary = { deviceId: payload?.identity?.deviceId, timestamp: payload?.timestamp };
      } catch {
        summary = { bytes: body.length };
      }
      if (options.marker) {
        fs.mkdirSync(path.dirname(options.marker), { recursive: true });
        fs.writeFileSync(options.marker, JSON.stringify({ ingested, ...summary }), "utf8");
      }
      console.log(`headless-hub-stub: ingest #${ingested} ${JSON.stringify(summary)}`);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  response.writeHead(404, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ error: "not_found", path: url.pathname }));
});

server.listen(options.port, "127.0.0.1", () => {
  console.log(`headless-hub-stub: listening on http://127.0.0.1:${options.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
