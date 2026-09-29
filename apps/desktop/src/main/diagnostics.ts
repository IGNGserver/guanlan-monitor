import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

const DIAGNOSTIC_FILE = "desktop-diagnostics.log";
const MAX_DIAGNOSTIC_BYTES = 2 * 1024 * 1024;

/**
 * Append one diagnostic line.
 *
 * Diagnostics are best-effort reporting, not a hot path, but they run in the main
 * process and were written with blocking `appendFileSync` plus a `statSync` and,
 * on rotation, a full read-and-rewrite. The async write keeps the main process
 * event loop free; a failure is still swallowed so diagnostics can never become a
 * second failure path. Ordering is preserved by chaining writes.
 */
let writeChain: Promise<void> = Promise.resolve();

export function appendDesktopDiagnostic(event: string, details: Record<string, unknown> = {}): void {
  let filePath: string;
  let line: string;
  try {
    filePath = path.join(app.getPath("userData"), DIAGNOSTIC_FILE);
    line = JSON.stringify({
      at: new Date().toISOString(),
      event,
      pid: process.pid,
      memory: process.memoryUsage(),
      ...details
    }, (_key, value) => value instanceof Error
      ? { name: value.name, message: value.message, stack: value.stack }
      : value);
  } catch {
    return;
  }
  writeChain = writeChain
    .then(() => fs.promises.mkdir(path.dirname(filePath), { recursive: true }))
    .then(() => fs.promises.appendFile(filePath, `${line}\n`, { encoding: "utf8" }))
    .then(async () => {
      const { size } = await fs.promises.stat(filePath);
      if (size > MAX_DIAGNOSTIC_BYTES) {
        const handle = await fs.promises.open(filePath, "r");
        try {
          const retained = Buffer.alloc(MAX_DIAGNOSTIC_BYTES / 2);
          const { bytesRead } = await handle.read(retained, 0, retained.length, size - retained.length);
          await fs.promises.writeFile(filePath, retained.subarray(0, bytesRead));
        } finally {
          await handle.close();
        }
      }
    })
    .catch(() => {
      // Diagnostics must never become a second failure path.
    });
}

/** Await any in-flight diagnostic writes. Used at shutdown and by tests. */
export function flushDesktopDiagnostics(): Promise<void> {
  return writeChain;
}
