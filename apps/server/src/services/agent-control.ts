import type { ServerResponse } from "node:http";
import type { ViewerRealtimeSnapshot } from "./viewer-presence.js";

type AgentStream = ServerResponse<import("node:http").IncomingMessage>;

export interface AgentRealtimeControlMessage extends ViewerRealtimeSnapshot {
  type: "viewer-realtime";
  deviceId: string;
  emittedAt: string;
}

export class AgentControlService {
  private readonly streamsByDevice = new Map<string, Set<AgentStream>>();

  connect(deviceId: string, stream: AgentStream) {
    const resolvedDeviceId = deviceId.trim();
    if (!resolvedDeviceId) {
      return;
    }

    const streams = this.streamsByDevice.get(resolvedDeviceId) ?? new Set<AgentStream>();
    streams.add(stream);
    this.streamsByDevice.set(resolvedDeviceId, streams);

    const cleanup = () => {
      const current = this.streamsByDevice.get(resolvedDeviceId);
      if (!current) {
        return;
      }
      current.delete(stream);
      if (current.size === 0) {
        this.streamsByDevice.delete(resolvedDeviceId);
      }
      stream.off("error", cleanup);
      if (socket) {
        socket.off("close", cleanup);
        socket.off("error", cleanup);
      } else {
        stream.off("close", cleanup);
      }
    };

    const socket = stream.socket;
    if (socket) {
      socket.on("close", cleanup);
      socket.on("error", cleanup);
    } else {
      stream.on("close", cleanup);
    }
    stream.on("error", cleanup);
  }

  sendViewerRealtime(stream: AgentStream, deviceId: string, snapshot: ViewerRealtimeSnapshot) {
    this.writePayload(stream, {
      type: "viewer-realtime",
      deviceId: deviceId.trim(),
      enabled: snapshot.enabled,
      viewerCount: snapshot.viewerCount,
      durationSeconds: snapshot.durationSeconds,
      expiresAt: snapshot.expiresAt,
      emittedAt: new Date().toISOString()
    });
  }

  publishViewerRealtime(deviceId: string, snapshot: ViewerRealtimeSnapshot) {
    const resolvedDeviceId = deviceId.trim();
    if (!resolvedDeviceId) {
      return;
    }

    const streams = this.streamsByDevice.get(resolvedDeviceId);
    if (!streams || streams.size === 0) {
      return;
    }

    for (const stream of streams) {
      if (stream.destroyed || stream.writableEnded) {
        streams.delete(stream);
        continue;
      }
      this.sendViewerRealtime(stream, resolvedDeviceId, snapshot);
    }

    if (streams.size === 0) {
      this.streamsByDevice.delete(resolvedDeviceId);
    }
  }

  private writePayload(stream: AgentStream, payload: AgentRealtimeControlMessage) {
    stream.write(`data: ${JSON.stringify(payload)}\n\n`);
    this.flushStream(stream);
  }

  writeComment(stream: AgentStream, comment: string) {
    stream.write(`: ${comment}\n\n`);
    this.flushStream(stream);
  }

  private flushStream(stream: AgentStream) {
    const flushable = stream as AgentStream & { flush?: () => void };
    flushable.flush?.();
  }
}
