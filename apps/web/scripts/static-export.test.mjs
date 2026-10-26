import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const web = fileURLToPath(new URL("..", import.meta.url));
const root = resolve(web, "../..");
const read = (path) => readFileSync(join(root, path), "utf8");

function loadConfig(staticExport) {
  const url = pathToFileURL(join(web, "next.config.mjs")).href;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `const { default: c } = await import(${JSON.stringify(url)}); console.log(JSON.stringify({ output: c.output, headers: c.headers ? await c.headers() : null }));`], {
    cwd: web, env: { ...process.env, NODE_ENV: "production", DSC_STATIC_EXPORT: String(staticExport) }, encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("delivery opts into export without changing next start consumers or shipping Next headers", () => {
  assert.equal(loadConfig(false).output, "standalone");
  assert.deepEqual(loadConfig(true), { output: "export", headers: null });
  const page = read("apps/web/src/app/devices/[deviceId]/page.tsx");
  assert.match(page, /generateStaticParams/);
  assert.match(page, /deviceId: "__shell"/);
  assert.match(page, /if \(process.env.DSC_STATIC_EXPORT === "true"\) return <UnifiedConsole \/>/);
  assert.match(read("apps/web/src/components/unified-console.tsx"), /decodeURIComponent\(window.location.pathname.slice/);
});

test("nginx and standalone publish exactly the same production security headers", () => {
  const rules = loadConfig(false).headers;
  const nginx = read("deploy/docker/web-security-headers.conf");
  for (const { key, value } of rules.find((rule) => rule.source === "/(.*)").headers) {
    const line = nginx.split("\n").find((line) => line.startsWith(`add_header ${key} `));
    assert.ok(line, key);
    let actual = line.slice(`add_header ${key} `.length).replace(/ always;$/, "");
    if (actual.startsWith('"')) actual = actual.slice(1, -1);
    assert.equal(actual, value, key);
  }
});

test("static route policy fails closed and retains manifest, worker and immutable asset contracts", () => {
  const nginx = read("deploy/docker/web.nginx.conf");
  assert.match(nginx, /location = \/manifest\.json\s*\{\s*types \{ application\/manifest\+json json;/);
  assert.match(nginx, /gzip on;/);
  assert.match(nginx, /gzip_vary on;/);
  assert.match(nginx, /default "no-store, no-cache, max-age=0, must-revalidate"/);
  assert.match(nginx, /public, max-age=31536000, immutable/);
  assert.ok(nginx.includes('map "$status:$uri" $web_cache_control'), "Missing assets must not inherit a year-long immutable 404");
  assert.ok(nginx.includes("(?:200|206|304):/_next/static/"));
  assert.match(nginx, /location = \/sw\.js/);
  assert.match(nginx, /\/sw\.js \/;/);
  assert.match(nginx, /if \(\$http_rsc != ""\) \{ return 404; \}/);
  assert.match(nginx, /if \(\$rsc_query\) \{ return 404; \}/);
  assert.ok(nginx.indexOf("txt|map|html") < nginx.indexOf("location ~ ^/devices/"));
  assert.match(nginx, /location ~ \^\/devices\/\[\^\/\]\+\$ \{ try_files \/index\.html =404; \}/);
  assert.match(nginx, /location \/ \{ return 404; \}/);
  assert.ok(!/try_files[^;]*\$uri\//.test(nginx), "No directory index or broad SPA fallback");
  assert.match(nginx, /include \/etc\/nginx\/web-security-headers\.conf;/);
});

test("all API and both realtime transports share an uncached fixed-target streaming proxy", () => {
  const nginx = read("deploy/docker/web.nginx.conf");
  const proxy = read("deploy/docker/web-proxy.conf");
  assert.match(nginx, /server server:4000 resolve;/);
  assert.match(nginx, /resolver 127\.0\.0\.11 valid=30s ipv6=off;/);
  for (const location of ["= /api", "^~ /api/", "= /socket.io", "^~ /socket.io/"]) {
    assert.ok(nginx.includes(`location ${location} { include /etc/nginx/web-proxy.conf; }`));
  }
  for (const directive of ["proxy_pass http://hub_backend;", "proxy_http_version 1.1;", "proxy_set_header Upgrade $websocket_upgrade;", "proxy_set_header Connection $websocket_connection;", "proxy_set_header X-Forwarded-Proto $forwarded_proto;", "proxy_set_header Forwarded \"\";", "proxy_buffering off;", "proxy_request_buffering off;", "proxy_cache off;", "proxy_hide_header Cache-Control;"]) assert.ok(proxy.includes(directive), directive);
  assert.ok(!proxy.includes("$http_x_forwarded_proto"));
  assert.ok(!/proxy_pass[^;]*\$/.test(proxy));
});

test("only an explicitly trusted TCP peer with an exact https XFP can assert TLS", () => {
  const nginx = read("deploy/docker/web.nginx.conf");
  assert.match(nginx, /geo \$remote_addr \$trusted_tls_proxy\s*\{\s*default 0;\s*include \/etc\/nginx\/web-trusted-tls-proxies\.conf;\s*\}/);
  assert.ok(!/\b(?:real_ip_header|set_real_ip_from)\b/.test(nginx));
  const map = nginx.match(/map "\$trusted_tls_proxy:\$http_x_forwarded_proto" \$forwarded_proto\s*\{([^}]+)\}/)?.[1];
  assert.ok(map);
  assert.match(map, /default \$scheme;/);
  const exact = map.match(/~(\^1:https\$) https;/)?.[1];
  assert.ok(exact, "nginx literal map keys are case-insensitive; use an exact case-sensitive regex");
  const matcher = new RegExp(exact);
  for (const [trusted, input, expected] of [[1, "https", "https"], [0, "https", "http"], [1, "http", "http"], [1, "HTTPS", "http"], [1, "https,http", "http"], [1, "http,https", "http"], [1, " https", "http"], [1, "https ", "http"], [1, "", "http"]]) {
    assert.equal(matcher.test(`${trusted}:${input}`) ? "https" : "http", expected, `${trusted}:${input}`);
  }
});

test("device slash canonicalization is relative, query-preserving and after denials", () => {
  const nginx = read("deploy/docker/web.nginx.conf");
  const redirect = nginx.indexOf("location ~ ^/devices/[^/]+/$");
  assert.ok(redirect > nginx.indexOf("location ~ (?:^|/)\\."));
  assert.ok(redirect > nginx.indexOf("txt|map|html"));
  assert.ok(redirect < nginx.indexOf("location ~ ^/devices/[^/]+$"));
  assert.match(nginx, /if \(\$canonical_device_uri = ""\) \{ return 404; \}/);
  assert.match(nginx, /absolute_redirect off;\s*return 308 \$canonical_device_uri;/);
  // Exercise the raw-URI mapping from the actual config (HTTP behavior is CI's
  // nginx check). Never reconstruct a redirect from a decoded location capture.
  const rawMap = nginx.match(/map \$request_uri \$canonical_device_uri\s*\{\s*default "";\s*~(\S+) \$1\$2;\s*\}/)?.[1];
  assert.ok(rawMap);
  const pattern = new RegExp(rawMap);
  for (const [input, expected] of [["/devices/a/", "/devices/a"], ["/devices/a/?window=24h&x=%2F", "/devices/a?window=24h&x=%2F"], ["/devices/a/?", "/devices/a?"], ["/devices/a%3Fb%23c/", "/devices/a%3Fb%23c"], ["/devices/%E8%AE%BE%E5%A4%87/", "/devices/%E8%AE%BE%E5%A4%87"]]) {
    const match = input.match(pattern);
    assert.ok(match, input);
    assert.equal(match[1] + (match[2] || ""), expected);
  }
  for (const input of ["/devices/", "/devices/a/b/", "//devices/a/", "/devices/a//", "/devices/a"]) assert.equal(pattern.test(input), false, input);
  // Export internals with a trailing slash must be denied before a redirect.
  assert.ok(nginx.includes("location ~* \\.(?:txt|map|html)/?$ { return 404; }"));
});

function rendererFixture() {
  assert.ok(!root.includes("/项目/"), "Run renderer tests from the local scratch snapshot");
  const directory = mkdtempSync(join(root, ".static-export-renderer-test-"));
  const output = join(directory, "trusted.conf");
  // If noglob is ever lost, '*' could expand into this valid-looking IP.
  writeFileSync(join(directory, "127.0.0.1"), "fixture");
  const run = (value, args = ["--test-output", output]) => {
    const env = { ...process.env };
    delete env.DSC_TRUSTED_TLS_PROXY_CIDRS;
    if (value !== undefined) env.DSC_TRUSTED_TLS_PROXY_CIDRS = value;
    writeFileSync(output, "previous configuration\n");
    return spawnSync("/bin/sh", [join(root, "deploy/docker/40-render-trusted-tls-proxies.sh"), ...args], { cwd: directory, env, encoding: "utf8" });
  };
  return { output, run };
}

test("POSIX renderer defaults to no trust and emits whitespace-separated IPv4/IPv6 entries", () => {
  const { output, run } = rendererFixture();
  for (const value of [undefined, "", " \t\n"]) {
    const result = run(value);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(output, "utf8"), "");
  }
  const result = run("127.0.0.1 192.0.2.0/24\n2001:db8::/64\t::1/128");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(output, "utf8"), "127.0.0.1 1;\n192.0.2.0/24 1;\n2001:db8::/64 1;\n::1/128 1;\n");
});

test("POSIX renderer rejects injection, glob expansion, default routes and oversized lists before writing", () => {
  const { output, run } = rendererFixture();
  for (const value of ["127.0.0.1;", "127.0.0.1\ninclude /tmp/other;", "$(touch bad)", "*", "?", "[0-9]*", "127.0.0.1,::1", "0.0.0.0/0", "::/0", "192.0.2.0/00", "::/000", "/32", "127.0.0.1/", "127.0.0.1/32/1", "127.0.0.1/-1", "127.0.0.1/+1", "127.0.0.1/0x20", Array(129).fill("127.0.0.1").join(" ")]) {
    const result = run(value);
    assert.notEqual(result.status, 0, value);
    assert.equal(readFileSync(output, "utf8"), "previous configuration\n", value);
  }
  const result = run(Array(128).fill("127.0.0.1").join(" "));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(output, "utf8").trim().split("\n").length, 128);
  assert.notEqual(run("127.0.0.1", ["--output", output]).status, 0);
});

test("official entrypoint installs an empty allowlist then validates runtime CIDRs with nginx -t", () => {
  const dockerfile = read("deploy/docker/web.Dockerfile");
  const renderer = read("deploy/docker/40-render-trusted-tls-proxies.sh");
  assert.ok(dockerfile.includes('LABEL io.guanlan.web-runtime="static-nginx"'));
  assert.ok(dockerfile.includes("RUN touch /etc/nginx/web-trusted-tls-proxies.conf"));
  assert.ok(dockerfile.includes("COPY --chmod=755 deploy/docker/40-render-trusted-tls-proxies.sh /docker-entrypoint.d/40-render-trusted-tls-proxies.sh"));
  assert.match(renderer, /^#!\/bin\/sh\n/);
  assert.match(renderer, /set -f\n/);
  assert.match(renderer, /output=\/etc\/nginx\/web-trusted-tls-proxies\.conf/);
  assert.match(renderer, /if \[ "\$test_only" -eq 0 \]; then[\s\S]*nginx -t\s*fi/);
  assert.ok(!/\b(?:node|python|eval|envsubst)\b/.test(renderer));
  const dockerignore = read(".dockerignore");
  assert.ok(dockerignore.includes("!deploy/docker"), "Web runtime files must enter the Docker build context");
  for (const file of ["web.nginx.conf", "web-proxy.conf", "web-security-headers.conf", "40-render-trusted-tls-proxies.sh"]) {
    assert.ok(dockerignore.includes(`!deploy/docker/${file}`), `Runtime COPY must not be ignored: ${file}`);
  }
});

test("post-export manifest and Workbox worker are copied into out after public was exported", () => {
  // Fixtures stay on the caller's local scratch, never on the source volume.
  assert.ok(!root.includes("/项目/"), "Run static-export tests from the local scratch snapshot");
  const fixture = join(root, ".static-export-test-fixture");
  for (const path of [".next/static/chunks", "public", "out"]) mkdirSync(join(fixture, path), { recursive: true });
  writeFileSync(join(fixture, "public/manifest.json"), "{}");
  writeFileSync(join(fixture, "public/manifest.webmanifest"), JSON.stringify({ icons: [] }));
  writeFileSync(join(fixture, "out/index.html"), "<html>fixture</html>");
  writeFileSync(join(fixture, "public/favicon.png"), "fixture");
  writeFileSync(join(fixture, "public/logo.png"), "fixture");
  writeFileSync(join(fixture, ".next/static/chunks/abcd1234.js"), "fixture");
  const result = spawnSync(process.execPath, [join(web, "scripts/generate-pwa-assets.mjs")], { cwd: fixture, env: { ...process.env, DSC_STATIC_EXPORT: "true" }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(join(fixture, "out/pwa-assets.json")));
  assert.ok(existsSync(join(fixture, "out/sw.js")));
  const manifest = JSON.parse(readFileSync(join(fixture, "out/pwa-assets.json"), "utf8"));
  assert.ok(manifest.assets.includes("/_next/static/chunks/abcd1234.js"));
  assert.equal(readFileSync(join(fixture, "out/pwa-assets.json"), "utf8"), readFileSync(join(fixture, "public/pwa-assets.json"), "utf8"));
});
