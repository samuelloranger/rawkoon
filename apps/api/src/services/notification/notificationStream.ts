import {
  notificationEventBus,
  type NotificationStreamEvent,
} from "@rawkoon/api/services/notification/notificationEvents";

// Cleanup is driven by the request abort signal.
export function createNotificationStream(
  userId: string,
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  // All setup happens INSIDE start(controller) — this mirrors the working
  // dashboard SSE (createJsonSseResponse). Capturing the controller in start
  // and enqueuing from outside does not flush the response under Bun.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | null = null;

      const writeChunk = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closeStream();
        }
      };

      const onNotification = (event: NotificationStreamEvent) => {
        if (event.userId !== userId) return;
        writeChunk(`data: ${JSON.stringify(event)}\n\n`);
      };

      const closeStream = () => {
        if (closed) return;
        closed = true;
        notificationEventBus.off("notification", onNotification);
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed by the runtime
        }
      };

      notificationEventBus.on("notification", onNotification);
      heartbeat = setInterval(() => writeChunk(": ping\n\n"), 15_000);
      signal.addEventListener("abort", closeStream);

      writeChunk("retry: 3000\n\n");
      // Handshake so the client knows the stream is live.
      writeChunk(`data: ${JSON.stringify({ connected: true })}\n\n`);
    },
    cancel() {
      // Cleanup is driven by the request abort signal above.
    },
  });
  return stream;
}
