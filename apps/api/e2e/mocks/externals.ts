import { mock } from "bun:test";
import { installFetchShim, mockState } from "./fetchShim";

export { mockState };

// Stub every external boundary before the app (or its route modules) is imported.
// Strategy: mock the npm packages that own the only non-fetch I/O — ioredis (the
// eager Valkey connection in db/valkey), bullmq (queue .add connections), and
// web-push (native push) — so app modules keep their real code and constants but
// never open a socket; plus a global fetch shim for the 14 HTTP boundaries.
// Prisma is intentionally NOT mocked — the harness uses the real rawkoon_e2e DB.
let installed = false;

export function installExternalMocks(): void {
  if (installed) return;
  installed = true;

  // ioredis: db/valkey.ts does `new Redis(...)` eagerly at import; stub it so no
  // socket opens and healthCheck's ping resolves.
  class StubRedis {
    on() {
      return this;
    }
    once() {
      return this;
    }
    async ping() {
      return "PONG";
    }
    async get() {
      return null;
    }
    async set() {
      return "OK";
    }
    async del() {
      return 0;
    }
    async quit() {
      return "OK";
    }
    disconnect() {}
  }
  mock.module("ioredis", () => ({ Redis: StubRedis, default: StubRedis }));

  // bullmq: queueService constructs Queues at import; stub Queue/Worker so .add
  // is a no-op and nothing dials Redis. queueService keeps its real constants.
  class StubQueue {
    async add() {
      return { id: "mock-job" };
    }
    async addBulk() {
      return [];
    }
    async close() {}
    async getJobCounts() {
      return {};
    }
    async obliterate() {}
    on() {
      return this;
    }
  }
  class StubWorker {
    async close() {}
    on() {
      return this;
    }
  }
  class StubQueueEvents {
    async close() {}
    on() {
      return this;
    }
  }
  mock.module("bullmq", () => ({
    Queue: StubQueue,
    Worker: StubWorker,
    QueueEvents: StubQueueEvents,
  }));

  // web-push: native push send (not fetch) — stub the default export.
  mock.module("web-push", () => ({
    default: {
      setVapidDetails() {},
      async sendNotification() {
        return { statusCode: 201, body: "", headers: {} };
      },
    },
  }));

  installFetchShim();
}
