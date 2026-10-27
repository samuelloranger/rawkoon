import { mock } from "bun:test";

type ModelMocks = ReturnType<typeof makeModelMocks>;

export function makeModelMocks() {
  return {
    findUnique: mock(async (..._: unknown[]) => null as unknown),
    findFirst: mock(async (..._: unknown[]) => null as unknown),
    findMany: mock(async (..._: unknown[]) => [] as unknown[]),
    create: mock(async (..._: unknown[]) => ({ id: 1 }) as unknown),
    update: mock(async (..._: unknown[]) => ({ id: 1 }) as unknown),
    updateMany: mock(async (..._: unknown[]) => ({ count: 0 })),
    delete: mock(async (..._: unknown[]) => ({ id: 1 }) as unknown),
    deleteMany: mock(async (..._: unknown[]) => ({ count: 0 })),
    count: mock(async (..._: unknown[]) => 0),
    aggregate: mock(async (..._: unknown[]) => ({}) as unknown),
    groupBy: mock(async (..._: unknown[]) => [] as unknown[]),
    upsert: mock(async (..._: unknown[]) => ({ id: 1 }) as unknown),
  };
}

const NON_MODEL_KEYS = new Set([
  "then",
  "toJSON",
  "$$typeof",
  "asymmetricMatch",
]);

/** Lazily creates and caches default model mocks for any model name. */
function lazyModels<T extends Record<string, unknown>>(): T {
  const cache = new Map<string, ModelMocks>();
  return new Proxy({} as T, {
    get(_t, key) {
      if (typeof key !== "string" || NON_MODEL_KEYS.has(key)) return undefined;
      if (key.startsWith("$")) return undefined;
      let m = cache.get(key);
      if (!m) {
        m = makeModelMocks();
        cache.set(key, m);
      }
      return m;
    },
    ownKeys: () => [...cache.keys()],
    getOwnPropertyDescriptor: (_t, key) =>
      typeof key === "string" && cache.has(key)
        ? { enumerable: true, configurable: true }
        : undefined,
  });
}

export const prismaMock = lazyModels<Record<string, ModelMocks>>();

export function clearPrismaMocks() {
  for (const key of Object.keys(prismaMock)) {
    for (const fn of Object.values(prismaMock[key])) fn.mockClear();
  }
}

/**
 * Wraps a test's partial prisma stub so any model or method it did not define
 * resolves to a default mock instead of crashing code under test (whose
 * try/catch would swallow the TypeError and hide the uncovered path).
 */
export function withDefaultModels<T extends object>(partial: T): T {
  const defaults = lazyModels<Record<string, ModelMocks>>();
  const modelProxies = new Map<string, unknown>();
  return new Proxy(partial, {
    get(target, key, receiver) {
      if (typeof key !== "string" || NON_MODEL_KEYS.has(key)) {
        return Reflect.get(target, key, receiver);
      }
      const own = Reflect.get(target, key, receiver);
      if (key === "$transaction" && own === undefined) {
        return async (arg: unknown) =>
          typeof arg === "function"
            ? (arg as (tx: unknown) => unknown)(receiver)
            : Promise.all(arg as unknown[]);
      }
      if (key.startsWith("$")) return own;
      if (own === undefined) return defaults[key];
      if (typeof own !== "object" || own === null) return own;
      let p = modelProxies.get(key);
      if (!p) {
        p = new Proxy(own, {
          get(m, method, r) {
            const v = Reflect.get(m, method, r);
            if (v !== undefined || typeof method !== "string") return v;
            if (NON_MODEL_KEYS.has(method)) return v;
            return (defaults[key] as Record<string, unknown>)[method];
          },
        });
        modelProxies.set(key, p);
      }
      return p;
    },
  });
}

/** Drop-in for `mock.module("@rawkoon/api/db", () => dbModule({ prisma: {...} }))`. */
export function dbModule<T extends { prisma: object }>(mod: T): T {
  return { ...mod, prisma: withDefaultModels(mod.prisma) };
}
