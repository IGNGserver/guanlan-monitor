import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = fs.readFileSync(path.join(root, "apps", "web", "next.config.ts"), "utf8");

for (const header of [
  "Content-Security-Policy",
  "X-Content-Type-Options",
  "X-Frame-Options",
  "Referrer-Policy",
  "Permissions-Policy",
  "Strict-Transport-Security"
]) {
  if (!config.includes(`key: \"${header}\"`)) throw new Error(`Web security header is missing: ${header}`);
}

if (!config.includes("frame-ancestors 'none'")) throw new Error("CSP must deny framing.");
if (!config.includes("object-src 'none'")) throw new Error("CSP must deny plugin content.");
if (!config.includes("connect-src 'self'")) throw new Error("CSP must restrict network connections.");
if (config.includes("includeSubDomains")) {
  throw new Error("HSTS must not claim includeSubDomains until every subdomain is HTTPS-only.");
}

console.log("Web security header configuration verified.");
