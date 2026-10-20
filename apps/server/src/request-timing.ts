import type { FastifyInstance } from "fastify";

/** Wall time through serialization, not network transfer or client rendering. */
export function registerRequestTiming(app: FastifyInstance): void {
  const started = new WeakMap<object, number>();
  app.addHook("onRequest", async (request) => { started.set(request, performance.now()); });
  app.addHook("onSend", async (request, reply, payload) => {
    const start = started.get(request);
    if (start !== undefined) {
      const duration = Math.max(0, performance.now() - start).toFixed(1);
      const previous = reply.getHeader("Server-Timing");
      reply.header("Server-Timing", `${typeof previous === "string" ? `${previous}, ` : ""}hub;dur=${duration}`);
    }
    return payload;
  });
}
