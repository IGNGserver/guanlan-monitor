import type { FastifyInstance } from "fastify";

/**
 * Every console client so far (web, Electron, iOS) declares `Content-Type: application/json` on
 * requests that carry no body at all: `DELETE /api/devices/:deviceId` and `POST /api/auth/logout`.
 * Fastify treats that combination as malformed (`FST_ERR_CTP_EMPTY_JSON_BODY`) and answers 400
 * before the route runs, so neither request ever reached its handler.
 *
 * A declared media type with zero bytes means "no body", not "broken JSON". Drop the declaration
 * when the transport says there is nothing to read so Fastify takes its no-body path. Requests
 * that do carry bytes keep the default parser, including its 400 for invalid JSON.
 */
export function tolerateEmptyJsonBody(app: FastifyInstance): void {
  // Async on purpose: a preParsing hook that returns neither a payload nor a promise and never
  // calls its done callback stops the hook chain, and the request would hang.
  app.addHook("preParsing", async (request) => {
    const contentType = request.headers["content-type"];
    if (typeof contentType !== "string" || !contentType.toLowerCase().startsWith("application/json")) return;
    // A chunked request can still stream bytes, so only a declared length of zero is safe to relax.
    if (request.headers["transfer-encoding"] !== undefined) return;
    const contentLength = request.headers["content-length"];
    if (contentLength !== undefined && contentLength !== "0") return;
    delete request.headers["content-type"];
  });
}
