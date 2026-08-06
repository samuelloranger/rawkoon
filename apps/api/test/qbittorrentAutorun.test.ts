import { describe, expect, it } from "bun:test";
import { decideAutorunUpdate } from "@rawkoon/api/services/qbittorrent/preferences";

const HOOK_PATH = "/api/download-client/hook/complete";
const desired = `curl -fsS -m 10 -X POST -H "X-Rawkoon-Token: tok" "http://rawkoon:3000${HOOK_PATH}?hash=%I"`;

describe("decideAutorunUpdate", () => {
  it("writes when no program is configured", () => {
    const r = decideAutorunUpdate({
      current: null,
      desired,
      hookPath: HOOK_PATH,
    });
    expect(r.action).toBe("write");
    expect(r.program).toBe(desired);
  });

  it("writes when the program is blank whitespace", () => {
    const r = decideAutorunUpdate({
      current: "   ",
      desired,
      hookPath: HOOK_PATH,
    });
    expect(r.action).toBe("write");
  });

  it("rewrites its own stale command, e.g. after a token rotation", () => {
    const stale = `curl -fsS -m 10 -X POST -H "X-Rawkoon-Token: OLD" "http://rawkoon:3000${HOOK_PATH}?hash=%I"`;
    const r = decideAutorunUpdate({
      current: stale,
      desired,
      hookPath: HOOK_PATH,
    });
    expect(r.action).toBe("write");
    expect(r.program).toBe(desired);
  });

  it("is a noop when the command already matches exactly", () => {
    const r = decideAutorunUpdate({
      current: desired,
      desired,
      hookPath: HOOK_PATH,
    });
    expect(r.action).toBe("noop");
  });

  it("never overwrites a program the user wrote", () => {
    const foreign = "/usr/local/bin/my-own-script.sh %I";
    const r = decideAutorunUpdate({
      current: foreign,
      desired,
      hookPath: HOOK_PATH,
    });
    expect(r.action).toBe("skip-foreign");
    expect(r.program).toBe(foreign);
  });
});

describe("token containment", () => {
  it("keeps the token out of the hook URL query string", () => {
    const url = new URL(desired.match(/"(https?:\/\/[^"]+)"/)![1]);
    expect(url.search).toBe("?hash=%I");
    expect(url.search).not.toContain("tok");
  });
});
