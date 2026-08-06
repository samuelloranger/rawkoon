import { describe, expect, it } from "bun:test";
import { handleCompletionHook } from "@rawkoon/api/routes/integrations/downloadClient/hookRoutes";

const VALID = "a".repeat(40);

function deps(over: { tokenOk?: boolean; pending?: boolean } = {}) {
  const calls = { stamped: 0, woke: 0 };
  return {
    calls,
    deps: {
      verifyToken: () => Promise.resolve(over.tokenOk ?? true),
      hasPendingForHash: () => Promise.resolve(over.pending ?? true),
      stampHookSeen: () => {
        calls.stamped++;
        return Promise.resolve();
      },
      wake: () => {
        calls.woke++;
        return Promise.resolve();
      },
    },
  };
}

describe("handleCompletionHook", () => {
  it("rejects a bad token with 401 and touches nothing", async () => {
    const d = deps({ tokenOk: false });
    const res = await handleCompletionHook(
      { token: "nope", hash: VALID },
      d.deps,
    );
    expect(res.status).toBe(401);
    expect(d.calls).toEqual({ stamped: 0, woke: 0 });
  });

  it("rejects a missing token with 401", async () => {
    const d = deps({ tokenOk: false });
    const res = await handleCompletionHook(
      { token: null, hash: VALID },
      d.deps,
    );
    expect(res.status).toBe(401);
  });

  it("rejects a malformed hash with 400 after auth", async () => {
    const d = deps();
    const res = await handleCompletionHook({ token: "t", hash: "zzz" }, d.deps);
    expect(res.status).toBe(400);
    expect(d.calls.woke).toBe(0);
  });

  it("accepts a 40-hex hash and wakes the poller", async () => {
    const d = deps();
    const res = await handleCompletionHook({ token: "t", hash: VALID }, d.deps);
    expect(res.status).toBe(202);
    expect(d.calls).toEqual({ stamped: 1, woke: 1 });
  });

  it("accepts a 64-hex v2 hash", async () => {
    const d = deps();
    const res = await handleCompletionHook(
      { token: "t", hash: "b".repeat(64) },
      d.deps,
    );
    expect(res.status).toBe(202);
    expect(d.calls.woke).toBe(1);
  });

  it("stamps but does not wake for a hash Rawkoon does not own", async () => {
    const d = deps({ pending: false });
    const res = await handleCompletionHook({ token: "t", hash: VALID }, d.deps);
    expect(res.status).toBe(202);
    expect(d.calls).toEqual({ stamped: 1, woke: 0 });
  });

  it("wakes without a hash filter when no hash is supplied", async () => {
    const d = deps({ pending: false });
    const res = await handleCompletionHook({ token: "t", hash: null }, d.deps);
    expect(res.status).toBe(202);
    expect(d.calls).toEqual({ stamped: 1, woke: 1 });
  });

  it("accepts an uppercase hash", async () => {
    const d = deps();
    const res = await handleCompletionHook(
      { token: "t", hash: "A".repeat(40) },
      d.deps,
    );
    expect(res.status).toBe(202);
  });
});
