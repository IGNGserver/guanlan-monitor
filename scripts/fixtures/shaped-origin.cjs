const http = require("node:http");
const { Transform } = require("node:stream");

// One shared byte scheduler per direction, not one 1 Mbps pipe per resource.
// Shaping at the origin also covers Worker/precaching requests without CDP
// target attachment assumptions. It is not a TCP loss/congestion emulator.
function byteScheduler(bytesPerSecond) {
  let next = 0;
  return (bytes) => {
    const now = performance.now();
    next = Math.max(now, next) + bytes * 1000 / bytesPerSecond;
    return Math.max(0, next - now);
  };
}

function pacedStream(reserve) {
  let timer;
  return new Transform({
    transform(chunk, _encoding, done) {
      timer = setTimeout(() => { timer = undefined; done(null, chunk); }, reserve(chunk.length));
    },
    destroy(error, done) { clearTimeout(timer); done(error); }
  });
}

async function createShapedOrigin(upstreamUrl, profile = { latencyMs: 300, downloadBps: 125000, uploadBps: 32000 }) {
  if (!Number.isFinite(profile.latencyMs) || profile.latencyMs < 0 || ![profile.downloadBps, profile.uploadBps].every((n) => Number.isFinite(n) && n > 0)) throw Error("invalid_network_profile");
  const upstream = new URL(upstreamUrl);
  let enabled = true;
  let download = byteScheduler(profile.downloadBps);
  let upload = byteScheduler(profile.uploadBps);
  const sockets = new Set();
  const server = http.createServer((request, response) => {
    const shaped = enabled;
    const proxy = http.request(new URL(request.url, upstream), { method: request.method, headers: { ...request.headers, host: upstream.host } });
    const outgoing = shaped ? pacedStream(upload) : null;
    let incoming; let timer;
    const stop = () => { clearTimeout(timer); proxy.destroy(); outgoing?.destroy(); incoming?.destroy(); };
    request.on("aborted", stop);
    response.on("close", stop);
    proxy.on("error", () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    proxy.on("response", (result) => {
      result.on("error", () => response.destroy());
      const start = () => {
        if (response.destroyed) { result.destroy(); return; }
        response.writeHead(result.statusCode ?? 502, result.headers);
        response.flushHeaders();
        if (shaped) { incoming = pacedStream(download); result.pipe(incoming).pipe(response); }
        else result.pipe(response);
      };
      if (shaped) timer = setTimeout(start, profile.latencyMs);
      else start();
    });
    if (outgoing) request.pipe(outgoing).pipe(proxy);
    else request.pipe(proxy);
  });
  server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  server.on("upgrade", (_request, socket) => socket.destroy());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    setEnabled(value) { enabled = value; download = byteScheduler(profile.downloadBps); upload = byteScheduler(profile.uploadBps); },
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      for (const socket of sockets) socket.destroy();
    })
  };
}
module.exports = { createShapedOrigin, byteScheduler };
