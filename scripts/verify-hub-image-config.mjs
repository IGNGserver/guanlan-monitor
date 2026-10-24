import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => {
  const target = path.join(root, relativePath);
  if (!fs.existsSync(target)) throw new Error(`Required file is missing: ${relativePath}`);
  return fs.readFileSync(target, "utf8");
};

// Guards the Hub deployment footprint: the published server/web images must
// ship only the server production closure / web public export, never the full
// workspace node_modules (including the desktop/Electron dependency closure).
const config = read(path.join("apps", "web", "next.config.mjs"));

if (fs.existsSync(path.join(root, "apps", "web", "next.config.ts"))) {
  throw new Error("next.config.ts must not exist: the standalone runtime loader cannot read TypeScript config.");
}
if (!config.includes('output: staticExport ? "export" : "standalone"') || !config.includes('process.env.DSC_STATIC_EXPORT === "true"')) {
  throw new Error("Web config must enable opt-in export and retain standalone for non-delivery tests.");
}
if (!/images:\s*\{\s*unoptimized:\s*true/.test(config)) {
  throw new Error("Web config must disable Next image optimization (the workspace uses plain <img> assets).");
}
if (!config.includes("outputFileTracingExcludes")) {
  throw new Error("Web config must exclude build-only tooling from the standalone trace.");
}

const webDockerfile = read(path.join("deploy", "docker", "web.Dockerfile"));
const runner = webDockerfile.split(/^FROM .* AS runner\s*$/m)[1];
if (!runner || !webDockerfile.includes('FROM ${NGINX_IMAGE} AS runner') || !/ARG NGINX_IMAGE=nginx:\d+\.\d+\.\d+-alpine[\d.]+@sha256:[a-f0-9]{64}\n/.test(webDockerfile)) {
  throw new Error("Web runtime must use an official version-and-digest-pinned nginx image.");
}
if (!webDockerfile.includes("ARG DSC_STATIC_EXPORT=true") || !webDockerfile.includes('test "$DSC_STATIC_EXPORT" = true') || !runner.includes("/app/apps/web/out/ /srv/guanlan/")) {
  throw new Error("Web Dockerfile must require and copy the static export.");
}
if (!runner.includes('CMD ["nginx", "-g", "daemon off;"]') || /node|pnpm|\.next|standalone|packages\/|apps\/web\/public/.test(runner.replace("/app/apps/web/out/", ""))) {
  throw new Error("Web runtime must not ship Node, Next, dependencies or workspace sources.");
}
for (const filename of ["web.nginx.conf", "web-proxy.conf", "web-security-headers.conf"]) {
  if (!runner.includes(`deploy/docker/${filename} /etc/nginx/`)) throw new Error(`Web runtime must install ${filename}.`);
}
if (!webDockerfile.includes("--filter @dsc/web...")) {
  throw new Error("Web Dockerfile must install only the @dsc/web dependency closure.");
}

const serverDockerfile = read(path.join("deploy", "docker", "server.Dockerfile"));
if (!serverDockerfile.includes("deploy /app/runtime --legacy --prod")) {
  throw new Error("Server Dockerfile must export a self-contained production runtime.");
}
if (!serverDockerfile.includes("--filter @dsc/server...")) {
  throw new Error("Server Dockerfile must install only the @dsc/server dependency closure.");
}

console.log("Minimal Hub image configuration verified.");
