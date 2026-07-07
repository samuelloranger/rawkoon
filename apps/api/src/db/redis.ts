import { Redis } from "ioredis";

const redisHost = Bun.env.REDIS_HOST || "localhost";
const redisPort = parseInt(Bun.env.REDIS_PORT || "6379");
const redisPassword = Bun.env.REDIS_PASSWORD;
const redisDb = parseInt(Bun.env.REDIS_DB || "0");

export const redisConnection = {
  host: redisHost,
  port: redisPort,
  username: "default",
  password: redisPassword,
  db: redisDb,
  // BullMQ needs these settings for stability
  maxRetriesPerRequest: null,
};

export const redis = new Redis(redisConnection);

redis.on("error", (err) => {
  console.error("Redis error:", err);
});

redis.on("connect", () => {
  if (Bun.env.NODE_ENV !== "test") {
    console.log(`Successfully connected to Redis at ${redisHost}:${redisPort}`);
  }
});
