/**
 * Headers for every Hub request. `Content-Type` is declared only when the request carries a body:
 * the Hub (Fastify) answers 400 to a JSON declaration on an empty body before the route runs, so a
 * bodyless request — `DELETE /api/devices/:deviceId` above all — must not declare one.
 *
 * Kept separate from the Hub client so the header policy is testable without Electron.
 */
export function hubRequestHeaders(init: RequestInit = {}): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (init.body !== undefined && init.body !== null) headers["Content-Type"] = "application/json";
  if (init.headers && typeof init.headers === "object" && !(init.headers instanceof Headers)) {
    Object.assign(headers, init.headers as Record<string, string>);
  }
  return headers;
}
