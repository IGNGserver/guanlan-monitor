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
// ship only the traced runtime, never the full workspace node_modules (which
// also drags in the desktop/Electron dependency closure).
const config = read(path.join("apps", "web", "next.config.mjs"));

if (fs.existsSync(path.join(root, "apps", "web", "next.config.ts"))) {
  throw new Error("next.config.ts must not exist: the standalone runtime loader cannot read TypeScript config.");
}
if (!config.includes('output: "standalone"')) {
  throw new Error("Web config must enable the standalone output for a minimal runtime image.");
}
if (!/images:\s*\{\s*unoptimized:\s*true/.test(config)) {
  throw new Error("Web config must disable Next image optimization (the workspace uses plain <img> assets).");
}
if (!config.includes("outputFileTracingExcludes")) {
  throw new Error("Web config must exclude build-only tooling from the standalone trace.");
}

const webDockerfile = read(path.join("deploy", "docker", "web.Dockerfile"));
if (!webDockerfile.includes(".next/standalone")) {
  throw new Error("Web Dockerfile must copy the Next standalone output.");
}
if (!webDockerfile.includes('CMD ["node", "apps/web/server.js"]')) {
  throw new Error("Web Dockerfile must start the standalone server directly with node.");
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
