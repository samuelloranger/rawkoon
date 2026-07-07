type IntervalMs<T> = number | ((payload: T) => number);

export type CreateJsonSseResponseOptions<T> = {
  request: Request;
  poll: () => Promise<T>;
  intervalMs: IntervalMs<T>;
  retryMs?: number;
  heartbeatMs?: number;
  onError?: (error: unknown) => T;
  logLabel?: string;
};

export function createJsonSseResponse<T>({
  request,
  poll,
  intervalMs,
  retryMs = 3000,
  heartbeatMs = 15000,
  onError,
  logLabel,
}: CreateJsonSseResponseOptions<T>): Response {
  const encoder = new TextEncoder();
  const signal = request.signal;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let pollTimeout: ReturnType<typeof setTimeout> | null = null;
      let heartbeatTimeout: ReturnType<typeof setTimeout> | null = null;
      let previousPayload = "";

      const closeStream = () => {
        if (closed) return;
        closed = true;
        if (pollTimeout) clearTimeout(pollTimeout);
        if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
        try {
          controller.close();
        } catch {
          // Stream may already be closed by the runtime.
        }
      };

      const writeChunk = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closeStream();
        }
      };

      const scheduleHeartbeat = () => {
        if (closed) return;
        heartbeatTimeout = setTimeout(() => {
          writeChunk(": ping\n\n");
          scheduleHeartbeat();
        }, heartbeatMs);
      };

      const schedulePoll = (ms: number) => {
        pollTimeout = setTimeout(
          () => {
            void pollOnce();
          },
          Math.max(250, Math.trunc(ms)),
        );
      };

      const pollOnce = async () => {
        if (closed) return;
        try {
          const snapshot = await poll();
          const payload = JSON.stringify(snapshot);
          if (payload !== previousPayload) {
            previousPayload = payload;
            writeChunk(`data: ${payload}\n\n`);
          }

          const nextMs =
            typeof intervalMs === "function"
              ? intervalMs(snapshot)
              : intervalMs;
          schedulePoll(nextMs);
        } catch (error) {
          if (onError) {
            try {
              const fallback = onError(error);
              const payload = JSON.stringify(fallback);
              if (payload !== previousPayload) {
                previousPayload = payload;
                writeChunk(`data: ${payload}\n\n`);
              }
            } catch (innerError) {
              if (logLabel)
                console.error(`${logLabel} SSE onError failed:`, innerError);
            }
          }

          if (logLabel) console.error(`${logLabel} SSE poll error:`, error);
          schedulePoll(retryMs);
        }
      };

      signal.addEventListener("abort", closeStream);

      writeChunk(`retry: ${Math.max(1000, Math.trunc(retryMs))}\n\n`);
      scheduleHeartbeat();
      void pollOnce();
    },
    cancel() {
      // No-op: timers are tied to request abort and internal stream closure.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
