const http = require("node:http");
const { fixtureDevices, overviewMetrics, metricFixture } = require("./web-console.cjs");

// Real HTTP keeps the same API fixtures reachable after a Worker controls the
// page, including engines whose Worker requests cannot use Playwright routing.
async function createFixtureProxy(upstreamUrl) {
  const upstream = new URL(upstreamUrl);
  const scenarios = new Map();
  let sequence = 0;
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://fixture.local");
    if (url.pathname.startsWith("/socket.io")) { response.writeHead(503); response.end(); return; }
    if (url.pathname.startsWith("/api/")) {
      const id = request.headers.cookie?.match(/(?:^|;\s*)dsc-fixture=([^;]+)/)?.[1];
      const scenario = scenarios.get(id);
      if (!scenario) { response.writeHead(401); response.end("{}"); return; }
      if (url.pathname === "/api/auth/session") scenario.sessionReads = (scenario.sessionReads ?? 0) + 1;
      if (scenario.mode === "hang") return;
      if (scenario.mode === "network") { response.destroy(); return; }
      if (scenario.mode === "unauthorized" || url.pathname === scenario.deniedPath) {
        response.writeHead(scenario.mode === "unauthorized" ? 401 : 403, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        response.end("{}"); return;
      }
      try {
        if (url.pathname === "/api/auth/session" && scenario.sessionDelay) {
          const delayed = scenario.sessionDelay;
          delete scenario.sessionDelay;
          scenario.sessionDelayStarted = true;
          await new Promise((resolve) => setTimeout(resolve, delayed.milliseconds));
          response.writeHead(delayed.status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          response.end("{}"); return;
        }
        let text = "";
        for await (const chunk of request) text += chunk;
        const body = text ? JSON.parse(text) : null;
        const pathname = url.pathname;
        let payload = {};
        if (pathname === "/api/auth/session") payload = { ok: true, issuedAt: scenario.scope ?? "2026-10-03T00:00:00Z" };
        if (pathname === "/api/instances") payload = scenario.mode === "empty" ? [] : scenario.devices;
        if (pathname === "/api/overview/metrics") payload = { ...overviewMetrics, window: url.searchParams.get("window") ?? "5m" };
        if (/^\/api\/devices\/[^/]+\/metrics$/.test(pathname)) {
          const id = decodeURIComponent(pathname.split("/")[3]);
          const device = scenario.devices.find((item) => item.deviceId === id);
          if (scenario.delayId === id) await new Promise((resolve) => setTimeout(resolve, 600));
          payload = { ...metricFixture(device ?? fixtureDevices[0]), window: url.searchParams.get("window") ?? "5m" };
        }
        if (pathname.endsWith("/traffic-calendar")) payload = null;
        if (request.method !== "GET") {
          scenario.mutations.push({ method: request.method, path: pathname });
          if (pathname === "/api/devices/reorder") {
            scenario.devices.sort((a, b) => body.deviceIds.indexOf(a.deviceId) - body.deviceIds.indexOf(b.deviceId));
            scenario.devices.forEach((device, index) => device.sortOrder = index);
          }
          if (request.method === "DELETE") scenario.devices = scenario.devices.filter((device) => device.deviceId !== decodeURIComponent(pathname.split("/")[3]));
        }
        response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        response.end(JSON.stringify(payload));
      } catch { response.writeHead(500); response.end("{}"); }
      return;
    }
    const proxy = http.request(new URL(request.url, upstream), { method: request.method, headers: { ...request.headers, host: upstream.host } }, (proxied) => {
      response.writeHead(proxied.statusCode ?? 502, proxied.headers);
      proxied.pipe(response);
    });
    proxy.on("error", () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    request.on("aborted", () => proxy.destroy());
    response.on("close", () => proxy.destroy());
    request.pipe(proxy);
  });
  server.on("upgrade", (_request, socket) => socket.destroy());
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}`;
  const pause = () => new Promise((resolve, reject) => {
    if (!server.listening) { resolve(); return; }
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
  return {
    url,
    register: (scenario) => { const id = String(++sequence); scenarios.set(id, scenario); return id; },
    pause,
    resume: () => new Promise((resolve, reject) => {
      const fail = (error) => reject(error);
      server.once("error", fail);
      server.listen(port, "127.0.0.1", () => { server.removeListener("error", fail); resolve(); });
    }),
    close: pause
  };
}
module.exports = { createFixtureProxy };
