import { describe, expect, it } from "vitest";
import { hasErrorChecks } from "../grabReadiness";

const check = (status: "ok" | "warn" | "error") => ({
  id: "download_client" as const,
  status,
  params: {},
});

describe("hasErrorChecks", () => {
  it("is true only for a real error", () => {
    expect(hasErrorChecks([check("ok"), check("error")])).toBe(true);
    expect(hasErrorChecks([check("ok"), check("warn")])).toBe(false);
    expect(hasErrorChecks(undefined)).toBe(false);
  });
});
