import { ApiError } from "./api.ts";

type GateState = "authenticated" | "anonymous" | "unavailable";
interface BootstrapPorts {
  establishSession: (supersede: boolean) => Promise<void>;
  restoreOffline: (current: () => boolean) => Promise<boolean>;
  current: () => boolean;
  show: (state: GateState) => void;
  onLive?: () => void;
}

/** A saved view is explicitly read-only, never proof of authentication. Let it
 * paint while the network checks the session; denial always wins over a late
 * storage result, and a late cache must not downgrade a live session.
 */
export async function bootstrapConsole(ports: BootstrapPorts, supersede = false): Promise<void> {
  let outcome: "pending" | "live" | "denied" | "unavailable" = "pending";
  const cacheCurrent = () => ports.current() && outcome !== "denied" && outcome !== "live";
  const cached = ports.restoreOffline(cacheCurrent).catch(() => false).then((restored) => {
    if (restored && cacheCurrent()) ports.show("authenticated");
    return restored;
  });
  try {
    await ports.establishSession(supersede);
    outcome = "live";
    if (ports.current()) { ports.show("authenticated"); ports.onLive?.(); }
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      outcome = "denied";
      if (ports.current()) ports.show("anonymous");
    } else {
      outcome = "unavailable";
      const restored = await cached;
      if (ports.current()) ports.show(restored ? "authenticated" : "unavailable");
    }
  }
}
