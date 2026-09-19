import { createHash, timingSafeEqual } from "node:crypto";
import type { SessionValue } from "./types.js";

export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export function credentialVersion(accessKey: string): string {
  return createHash("sha256").update(accessKey, "utf8").digest("hex");
}

export function createSession(accessKey: string, now = new Date()): SessionValue {
  const issuedAt = now.toISOString();
  return {
    issuedAt,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    credentialVersion: credentialVersion(accessKey)
  };
}

export function parseSessionValue(
  encodedValue: string,
  accessKey: string,
  now = Date.now()
): SessionValue | null {
  try {
    const session = JSON.parse(Buffer.from(encodedValue, "base64url").toString("utf8")) as Partial<SessionValue>;
    if (
      typeof session.issuedAt !== "string" ||
      typeof session.expiresAt !== "string" ||
      typeof session.credentialVersion !== "string"
    ) {
      return null;
    }

    const issuedAt = Date.parse(session.issuedAt);
    const expiresAt = Date.parse(session.expiresAt);
    if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) return null;
    if (issuedAt > now || expiresAt <= now || expiresAt - issuedAt > SESSION_TTL_MS) return null;
    if (!safeEqual(session.credentialVersion, credentialVersion(accessKey))) return null;

    return {
      issuedAt: new Date(issuedAt).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
      credentialVersion: session.credentialVersion
    };
  } catch {
    return null;
  }
}

export function millisecondsUntilSessionExpiry(session: SessionValue, now = Date.now()): number {
  const expiresAt = Date.parse(session.expiresAt);
  if (!Number.isFinite(expiresAt)) return 0;
  return Math.max(0, expiresAt - now);
}

export function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function getBearerToken(header: string | undefined): string | null {
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

const AUTH_FAILURE_WINDOW_MS = 60_000;
const AUTH_FAILURE_MAX_ATTEMPTS = 5;

export class AuthFailureRateLimiter {
  private readonly attempts = new Map<string, { startedAt: number; count: number }>();

  allow(key: string, now = Date.now()): boolean {
    const current = this.attempts.get(key);
    if (!current || now - current.startedAt >= AUTH_FAILURE_WINDOW_MS) {
      return true;
    }
    return current.count < AUTH_FAILURE_MAX_ATTEMPTS;
  }

  recordFailure(key: string, now = Date.now()): void {
    const current = this.attempts.get(key);
    if (!current || now - current.startedAt >= AUTH_FAILURE_WINDOW_MS) {
      this.attempts.set(key, { startedAt: now, count: 1 });
      this.prune(now);
      return;
    }
    current.count += 1;
  }

  clear(key: string): void {
    this.attempts.delete(key);
  }

  private prune(now: number): void {
    for (const [key, value] of this.attempts) {
      if (now - value.startedAt >= AUTH_FAILURE_WINDOW_MS) this.attempts.delete(key);
    }
  }
}

export const authRateLimiter = new AuthFailureRateLimiter();
