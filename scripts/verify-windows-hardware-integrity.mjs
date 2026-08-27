import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultBinary = path.join(root, "agents", "windows-hardware", "pawnio", "PawnIO_setup.exe");
const metadataPath = path.join(root, "agents", "windows-hardware", "pawnio", "PawnIO_setup.exe.source.json");
const sidecarPath = path.join(root, "agents", "windows-hardware", "pawnio", "PawnIO_setup.exe.sha256");
const binaryPath = path.resolve(process.argv[2] ?? defaultBinary);
const expectedSource = "https://github.com/namazso/PawnIO.Setup/releases/download/2.2.0/PawnIO_setup.exe";
const expectedSha256 = "1f519a22e47187f70a1379a48ca604981c4fcf694f4e65b734aaa74a9fba3032";

const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
if (
  metadata?.source !== expectedSource ||
  metadata?.sha256 !== expectedSha256
) {
  throw new Error("PawnIO source metadata is not pinned to the expected official release.");
}

const sidecar = await readFile(sidecarPath, "utf8");
const sidecarHash = sidecar.match(/^([a-f0-9]{64})\s+.*PawnIO_setup\.exe\s*$/im)?.[1];
if (!sidecarHash) throw new Error("PawnIO SHA-256 sidecar is missing or malformed.");
if (sidecarHash !== expectedSha256) throw new Error("PawnIO SHA-256 sidecar is not pinned to the expected source hash.");

const digest = createHash("sha256").update(await readFile(binaryPath)).digest("hex");
if (digest !== expectedSha256) {
  throw new Error(`PawnIO SHA-256 mismatch for ${binaryPath}: ${digest}`);
}

console.log(`PawnIO integrity verified: ${digest}`);
