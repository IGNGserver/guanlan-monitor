const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync("apps/web/public/sw.js", "utf8");
function harness({ failAsset = null, revision = "test", shellRevision = "test" } = {}) {
  const events = {};
  const buckets = new Map();
  const calls = [];
  const caches = {
    keys: async () => [...buckets.keys()],
    delete: async (key) => buckets.delete(key),
    open: async (key) => {
      if (!buckets.has(key)) buckets.set(key, new Map());
      const bucket = buckets.get(key);
      return { match: async (url) => bucket.get(url)?.clone(), put: async (url, value) => bucket.set(url, value.clone()) };
    }
  };
  const fetch = async (url, options) => {
    calls.push({ url, options });
    if (url === "/pwa-assets.json") return Response.json({ revision, assets: ["/", "/_next/static/app.js", "/logo.png"] });
    if (url === failAsset) return new Response("missing", { status: 404 });
    if (url === "/") return new Response(`<meta name="guanlan-pwa-revision" content="${shellRevision}">`);
    return new Response("public asset");
  };
  const context = vm.createContext({ URL, Response, Set, Promise, fetch, caches,
    self: { location: new URL("https://hub.example/sw.js?revision=test"), addEventListener: (name, handler) => events[name] = handler, skipWaiting: async () => {}, clients: { claim: async () => {} } } });
  vm.runInContext(source, context);
  const install = () => new Promise((resolve, reject) => events.install({ waitUntil: (promise) => promise.then(resolve, reject) }));
  return { context, events, buckets, calls, install };
}
test("install is atomic and omits credentials for every public shell request", async () => {
  const h = harness();
  await h.install();
  assert.equal(h.buckets.get("guanlan-shell-test").size, 4);
  assert.ok(h.calls.every((call) => call.options.credentials === "omit"));
  assert.equal(h.events.message({ data: { type: "unrelated" } }), undefined);
});
test("partial, mismatched and mixed-generation installs keep the active cache", async () => {
  for (const input of [{ failAsset: "/logo.png" }, { revision: "next" }, { shellRevision: "next" }]) {
    const h = harness(input);
    h.buckets.set("guanlan-shell-previous", new Map([["/", new Response("working shell")]]));
    await assert.rejects(h.install());
    assert.equal(h.buckets.has("guanlan-shell-test"), false);
    assert.equal(await h.buckets.get("guanlan-shell-previous").get("/").text(), "working shell");
  }
});
test("API, sockets, RSC, mutations and other origins bypass the worker", () => {
  const h = harness();
  for (const [path, method, headers] of [["/api/instances", "GET", {}], ["/api/auth/login", "POST", {}], ["/socket.io/?transport=websocket", "GET", {}], ["/?_rsc=1", "GET", {}], ["/devices/a", "GET", { RSC: "1" }], ["https://other.example/logo.png", "GET", {}]]) {
    let intercepted = false;
    h.events.fetch({ request: { url: new URL(path, "https://hub.example").href, method, headers: new Headers(headers), mode: "cors" }, respondWith: () => intercepted = true });
    assert.equal(intercepted, false, path);
  }
});

test("production CSP allows its own worker without allowing eval", async () => {
  const previousDirectory = process.cwd();
  const previousMode = process.env.NODE_ENV;
  const configUrl = require("node:url").pathToFileURL(require("node:path").resolve("apps/web/next.config.mjs"));
  try {
    process.chdir("apps/web");
    process.env.NODE_ENV = "production";
    const { default: config } = await import(configUrl.href);
    const rules = await config.headers();
    const csp = rules.find((rule) => rule.source === "/(.*)").headers.find((header) => header.key === "Content-Security-Policy").value;
    assert.ok(csp.includes("worker-src 'self'"));
    assert.ok(!csp.includes("'unsafe-eval'"));
  } finally {
    process.chdir(previousDirectory);
    if (previousMode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousMode;
  }
});
