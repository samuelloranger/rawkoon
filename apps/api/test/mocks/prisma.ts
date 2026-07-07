import { mock } from "bun:test";

function makeModelMocks() {
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
    upsert: mock(async (..._: unknown[]) => ({ id: 1 }) as unknown),
  };
}

export const prismaMock = {
  downloadHistory: makeModelMocks(),
  libraryMedia: makeModelMocks(),
  libraryEpisode: makeModelMocks(),
  libraryBook: makeModelMocks(),
  mediaFile: makeModelMocks(),
  mediaSettings: makeModelMocks(),
  libraryAttentionAlert: makeModelMocks(),
  grabBlocklist: makeModelMocks(),
  integration: makeModelMocks(),
  oidcProvider: makeModelMocks(),
};

export function clearPrismaMocks() {
  for (const model of Object.values(prismaMock)) {
    for (const fn of Object.values(model)) {
      fn.mockClear();
    }
  }
}
