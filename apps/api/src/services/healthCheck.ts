import { prisma } from "@rawkoon/api/db";
import { redis } from "@rawkoon/api/db/redis";

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export type HealthPayload = {
  status: "ok" | "degraded";
  db: boolean;
  redis: boolean;
};

/** Prisma SELECT 1 + redis.ping, each bounded so a hung dependency cannot stall probes. */
export async function checkHealth(timeoutMs = 2000): Promise<HealthPayload> {
  const pingDb = Promise.resolve().then(() => prisma.$queryRaw`SELECT 1`);
  const pingRedis = Promise.resolve().then(() => redis.ping());

  const [db, redisOk] = await Promise.all([
    withTimeout(pingDb, timeoutMs)
      .then(() => true)
      .catch(() => false),
    withTimeout(pingRedis, timeoutMs)
      .then((reply) => reply === "PONG")
      .catch(() => false),
  ]);

  return {
    status: db && redisOk ? "ok" : "degraded",
    db,
    redis: redisOk,
  };
}
