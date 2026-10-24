import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = fs.readFileSync(path.join(root, "apps", "web", "next.config.mjs"), "utf8");
const nginx = fs.readFileSync(path.join(root, "deploy/docker/web-security-headers.conf"), "utf8");

for (const header of [
  "Content-Security-Policy",
  "X-Content-Type-Options",
  "X-Frame-Options",
  "Referrer-Policy",
  "Permissions-Policy",
  "Strict-Transport-Security"
]) {
  if (!config.includes(`key: \"${header}\"`)) throw new Error(`Web security header is missing: ${header}`);
  if (!new RegExp(`add_header ${header} [^\\n]+ always;`).test(nginx)) throw new Error(`nginx security header is missing or not unconditional: ${header}`);
}

if (!config.includes("frame-ancestors 'none'")) throw new Error("CSP must deny framing.");
if (!config.includes("object-src 'none'")) throw new Error("CSP must deny plugin content.");
if (!config.includes("connect-src 'self'")) throw new Error("CSP must restrict network connections.");
for (const directive of ["default-src 'self'", "base-uri 'self'", "object-src 'none'", "frame-ancestors 'none'", "form-action 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self' data:", "connect-src 'self'", "worker-src 'self'"]) {
  if (!nginx.includes(directive)) throw new Error(`nginx CSP is missing: ${directive}`);
}
if (nginx.includes("unsafe-eval")) throw new Error("nginx production CSP must not permit eval.");
if (config.includes("includeSubDomains") || nginx.includes("includeSubDomains")) {
  throw new Error("HSTS must not claim includeSubDomains until every subdomain is HTTPS-only.");
}

console.log("Web security header configuration verified.");
