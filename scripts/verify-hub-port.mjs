import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const checks = [
  [read(".env.example").includes("WEB_PORT=38472"), ".env.example must expose the Hub on port 38472."],
  [read("docker-compose.yml").includes('"${WEB_PORT:-38472}:3000"'), "Docker Compose must default the public Hub port to 38472."],
  [read("apps/web/src/middleware.ts").includes("http://127.0.0.1:4000"), "Web middleware must retain the internal server fallback."],
  [read("apps/web/src/lib/api.ts").includes("http://127.0.0.1:4000"), "Server-side web API calls must retain the internal fallback."],
  [read(".github/workflows/deploy-test.yml").includes('WEB_PORT: "38472"'), "Test deployment must force the public Hub port to 38472."],
  [read(".github/workflows/deploy-production.yml").includes('WEB_PORT: "38472"'), "Production deployment must force the public Hub port to 38472."],
];

for (const [condition, message] of checks) {
  if (!condition) throw new Error(message);
}

console.log("Hub public port check passed: 38472 (internal API port remains 4000).");
