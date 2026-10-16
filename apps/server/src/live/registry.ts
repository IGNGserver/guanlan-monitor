import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { LiveConnection, LiveSnapshot, LiveTopic } from "@dsc/shared";

export const LIVE_LEASE_MS = 15_000;
export const LIVE_REQUEST_MS = 5_000;
/**
 * A completed result is served to every viewer for this long. It bounds device
 * collection to about one run per topic per second however many viewers poll,
 * and however fast a misbehaving client loops.
 */
export const LIVE_RESULT_TTL_MS = 900;
/** Same-identity reconnects replace a stale session; this many within the window means two live copies of one identity. */
export const LIVE_TAKEOVER_LIMIT = 3;
export const LIVE_TAKEOVER_WINDOW_MS = 60_000;

export class LiveError extends Error {
  constructor(public readonly code: string, public readonly statusCode = 503) { super(code); }
}

export interface LiveTransport {
  isOpen(): boolean;
  send(message: object): void;
  close(): void;
}

interface Pending {
  id: string;
  topic: LiveTopic;
  acknowledged: boolean;
  deadline: number;
  timer: ReturnType<typeof setTimeout>;
  resolve(value: LiveSnapshot): void;
  reject(error: Error): void;
}

export interface AgentSession {
  readonly deviceId: string;
  readonly id: string;
  readonly transport: LiveTransport;
  readonly connectedAt: string;
  capabilities: LiveTopic[];
  ready: boolean;
  expiresAt: number;
  challenge: string | null;
  pending: Map<string, Pending>;
  requests: Map<LiveTopic, Promise<LiveSnapshot>>;
  results: Map<LiveTopic, { snapshot: LiveSnapshot; at: number }>;
}

/** Single-Hub connection ownership. Durable device status is deliberately never consulted. */
export class LiveRegistry {
  private readonly sessions = new Map<string, AgentSession>();
  private readonly takeovers = new Map<string, number[]>();
  private closed = false;
  constructor(private readonly now = () => performance.now(), private readonly requestMs = LIVE_REQUEST_MS) {}

  attach(deviceId: string, transport: LiveTransport): AgentSession {
    if (this.closed) throw new LiveError("hub_shutting_down");
    const previous = this.sessions.get(deviceId);
    if (previous && this.valid(previous)) {
      // Only the enrolled installation can authenticate, so a second connection
      // is normally that installation reconnecting after a silent network drop
      // the Hub has not noticed yet. Repeated takeovers mean a copied identity
      // is running twice: refuse instead of letting the two flip-flop.
      const now = this.now();
      const recent = (this.takeovers.get(deviceId) ?? []).filter((at) => now - at < LIVE_TAKEOVER_WINDOW_MS);
      if (recent.length >= LIVE_TAKEOVER_LIMIT) {
        this.takeovers.set(deviceId, recent);
        throw new LiveError("device_session_conflict", 409);
      }
      this.takeovers.set(deviceId, [...recent, now]);
    }
    if (previous) this.detach(previous);
    const session: AgentSession = {
      deviceId, id: randomUUID(), transport, connectedAt: new Date().toISOString(),
      capabilities: [], ready: false, expiresAt: this.now() + 5_000, challenge: null,
      pending: new Map(), requests: new Map(), results: new Map()
    };
    this.sessions.set(deviceId, session);
    return session;
  }

  private valid(session: AgentSession): boolean {
    return this.sessions.get(session.deviceId) === session && session.transport.isOpen() && session.expiresAt > this.now();
  }

  describe(deviceId: string): LiveConnection {
    const session = this.sessions.get(deviceId);
    if (!session || !this.valid(session)) {
      if (session) this.detach(session);
      return { state: "disconnected", sessionId: null, capabilities: [], connectedAt: null };
    }
    return { state: session.ready ? "ready" : "connecting", sessionId: session.id, capabilities: [...session.capabilities], connectedAt: session.connectedAt };
  }

  ready(session: AgentSession, capabilities: LiveTopic[]): void {
    if (!this.valid(session) || session.ready) throw new LiveError("invalid_agent_handshake", 400);
    session.capabilities = [...new Set(capabilities)];
    session.ready = true;
    session.expiresAt = this.now() + LIVE_LEASE_MS;
  }

  heartbeat(session: AgentSession): void {
    if (!this.valid(session)) { this.detach(session); return; }
    // Do not replace an outstanding challenge: only its matching pong renews the lease.
    session.challenge ??= randomUUID();
    this.send(session, { type: "ping", sessionId: session.id, nonce: session.challenge });
  }

  pong(session: AgentSession, nonce: string): void {
    if (!this.valid(session) || !session.challenge || nonce !== session.challenge) return;
    session.challenge = null;
    session.expiresAt = this.now() + LIVE_LEASE_MS;
  }

  read(deviceId: string, topic: LiveTopic): Promise<LiveSnapshot> {
    const session = this.sessions.get(deviceId);
    if (!session || !this.valid(session) || !session.ready) {
      if (session && !this.valid(session)) this.detach(session);
      return Promise.reject(new LiveError("device_not_connected"));
    }
    if (!session.capabilities.includes(topic)) return Promise.reject(new LiveError("device_capability_unavailable", 422));
    const cached = session.results.get(topic);
    if (cached && this.now() - cached.at < LIVE_RESULT_TTL_MS) return Promise.resolve(cached.snapshot);
    const inFlight = session.requests.get(topic);
    if (inFlight) return inFlight;
    if ([...this.sessions.values()].reduce((total, item) => total + item.pending.size, 0) >= 256) {
      return Promise.reject(new LiveError("live_query_capacity_exceeded", 429));
    }
    const id = randomUUID();
    const promise = new Promise<LiveSnapshot>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = session.pending.get(id);
        if (!pending) return;
        session.pending.delete(id);
        reject(new LiveError(pending.acknowledged ? "device_response_timeout" : "device_ack_timeout", 504));
      }, this.requestMs);
      timer.unref();
      session.pending.set(id, { id, topic, acknowledged: false, deadline: this.now() + this.requestMs, timer, resolve, reject });
      try {
        this.send(session, { type: "request", sessionId: session.id, requestId: id, topic, timeoutMs: this.requestMs });
      } catch (error) {
        this.finish(session, id, error instanceof Error ? error : new LiveError("device_disconnected"));
      }
    });
    session.requests.set(topic, promise);
    void promise.finally(() => { if (session.requests.get(topic) === promise) session.requests.delete(topic); }).catch(() => undefined);
    return promise;
  }

  acknowledge(session: AgentSession, id: string): void {
    if (!this.valid(session)) return;
    const pending = session.pending.get(id);
    if (pending) pending.acknowledged = true;
  }

  result(session: AgentSession, id: string, topic: LiveTopic, data: LiveSnapshot["data"]): void {
    if (!this.valid(session)) { this.detach(session); return; }
    const pending = session.pending.get(id);
    if (!pending || pending.topic !== topic || !pending.acknowledged) return;
    // Timer callbacks may be delayed by a busy event loop. The deadline itself is authoritative.
    if (this.now() >= pending.deadline) {
      this.finish(session, id, new LiveError("device_response_timeout", 504));
      return;
    }
    clearTimeout(pending.timer);
    session.pending.delete(id);
    const snapshot: LiveSnapshot = { deviceId: session.deviceId, sessionId: session.id, requestId: id, topic, receivedAt: new Date().toISOString(), data };
    session.results.set(topic, { snapshot, at: this.now() });
    pending.resolve(snapshot);
  }

  fail(session: AgentSession, id: string, code: string): void {
    if (this.valid(session)) this.finish(session, id, new LiveError(code, 502));
  }

  private finish(session: AgentSession, id: string, error: Error): void {
    const pending = session.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    session.pending.delete(id);
    pending.reject(error);
  }

  private send(session: AgentSession, message: object): void {
    if (!this.valid(session)) { this.detach(session); throw new LiveError("device_disconnected"); }
    try { session.transport.send(message); }
    catch { this.detach(session); throw new LiveError("device_disconnected"); }
  }

  detach(session: AgentSession): void {
    if (this.sessions.get(session.deviceId) === session) this.sessions.delete(session.deviceId);
    for (const id of session.pending.keys()) this.finish(session, id, new LiveError("device_disconnected"));
    session.transport.close();
  }

  closeDevice(deviceId: string): void { const session = this.sessions.get(deviceId); if (session) this.detach(session); }
  close(): void { this.closed = true; for (const session of this.sessions.values()) this.detach(session); }
}
