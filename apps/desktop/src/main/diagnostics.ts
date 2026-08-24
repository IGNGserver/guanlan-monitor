import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

const DIAGNOSTIC_FILE = "desktop-diagnostics.log";
const MAX_DIAGNOSTIC_BYTES = 2 * 1024 * 1024;

export function appendDesktopDiagnostic(event: string, details: Record<string, unknown> = {}): void {
  try {
    const filePath = path.join(app.getPath("userData"), DIAGNOSTIC_FILE);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const line = JSON.stringify({
      at: new Date().toISOString(),
      event,
      pid: process.pid,
      memory: process.memoryUsage(),
      ...details
    }, (_key, value) => value instanceof Error
      ? { name: value.name, message: value.message, stack: value.stack }
      : value);

    fs.appendFileSync(filePath, `${line}\n`, { encoding: "utf8" });
    const size = fs.statSync(filePath).size;
    if (size > MAX_DIAGNOSTIC_BYTES) {
      const retained = fs.readFileSync(filePath).subarray(-MAX_DIAGNOSTIC_BYTES / 2);
      fs.writeFileSync(filePath, retained);
    }
  } catch {
    // Diagnostics must never become a second failure path.
  }
}
