import { mock } from "bun:test";

// Set required env vars for config validation in tests (only if not already set)
// DATABASE_URL must NOT be set if no real DB is available — integration tests check its presence
process.env.SECRET_KEY ??=
  "test-secret-key-for-tests-must-be-at-least-32-characters";
process.env.BASE_URL ??= "http://localhost:3000";

// Mock ioredis Redis singleton so it doesn't try to connect
mock.module("../src/db/redis", () => {
  const mockRedis = {
    on: function (this: any) {
      return this;
    },
    get: async () => null,
    set: async () => "OK",
    del: async () => 0,
    expire: async () => 0,
    send: async () => null,
    quit: async () => {},
  };
  return {
    redis: mockRedis,
    redisConnection: {
      host: "localhost",
      port: 6379,
      db: 0,
      maxRetriesPerRequest: null,
    },
  };
});

// Mock queueService so BullMQ never tries to connect to Redis
const mockQueue = { add: async () => null, close: async () => {} };
mock.module("../src/services/queueService", () => ({
  QUEUE_NAMES: {
    EXPRESS: "express",
    SCHEDULED_TASKS: "scheduled-tasks",
    LIBRARY_MIGRATE: "library-migrate",
    LIBRARY_REINDEX_LANGUAGES: "library-reindex-languages",
    LIBRARY_REMUX: "library-remux",
  },
  SCHEDULED_JOB_NAMES: {
    CHECK_REMINDERS: "check-reminders",
    CHECK_ALL_DAY_EVENTS: "check-all-day-events",
    CLEANUP_NOTIFICATIONS: "cleanup-notifications",
    REFRESH_HABITS_STREAK_FOR_USER: "refresh-habits-streak-for-user",
  },
  NOTIFICATION_JOB_NAMES: {
    SEND_NOTIFICATION: "send-notification",
  },
  expressQueue: mockQueue,
  scheduledTasksQueue: mockQueue,
  libraryMigrateQueue: mockQueue,
  libraryReindexLanguagesQueue: mockQueue,
  libraryRemuxQueue: mockQueue,
  addJob: async () => null,
  initWorkers: () => {},
  setupScheduledJobs: async () => {},
}));

// Mock Bun's RedisClient so tests don't try to connect to a real Redis instance
mock.module("../src/services/cache", () => ({
  getJsonCache: async (_key: string) => null,
  setJsonCache: async (_key: string, _value: unknown, _ttl: number) => {},
  deleteCache: async (_key: string) => {},
  acquireLock: async (_key: string, _ttl: number) => true,
  releaseLock: async (_key: string) => {},
}));

// Suppress Prisma connection errors when DATABASE_URL is not set
mock.module("../src/db", () => ({
  prisma: new Proxy(
    {},
    {
      get(_target, _prop) {
        return new Proxy(() => {}, {
          get(_t, _prop) {
            return () => Promise.resolve(null);
          },
          apply() {
            return Promise.resolve(null);
          },
        });
      },
    },
  ),
}));
