// apps/api/src/utils/medias/customFormatValidation.test.ts
import { describe, expect, test } from "bun:test";
import { validateFormatConditions } from "@rawkoon/api/utils/medias/customFormatValidation";

describe("validateFormatConditions", () => {
  test("accepts a valid regex condition", () => {
    const r = validateFormatConditions([
      { type: "title_regex", operator: "matches", value: "atmos" },
    ]);
    expect(r.ok).toBe(true);
  });

  test("accepts seeders numeric + between", () => {
    expect(
      validateFormatConditions([{ type: "seeders", operator: "gte", value: 5 }])
        .ok,
    ).toBe(true);
    expect(
      validateFormatConditions([
        { type: "size_range", operator: "between", value: [1, 10] },
      ]).ok,
    ).toBe(true);
  });

  test("rejects non-array", () => {
    const r = validateFormatConditions("nope");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("conditions_not_array");
  });

  test("rejects empty array", () => {
    const r = validateFormatConditions([]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("conditions_empty");
  });

  test("rejects unknown condition type", () => {
    const r = validateFormatConditions([
      { type: "bogus", operator: "equals", value: "x" },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("condition_type_invalid");
  });

  test("rejects an operator not allowed for the type (e.g. regex op on source)", () => {
    const r = validateFormatConditions([
      { type: "source", operator: "matches", value: "x" },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("operator_invalid_for_type");
  });

  test("rejects invalid regex value", () => {
    const r = validateFormatConditions([
      { type: "title_regex", operator: "matches", value: "(" },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("regex_invalid");
  });

  test("rejects between without a 2-number tuple", () => {
    const r = validateFormatConditions([
      { type: "size_range", operator: "between", value: [1] },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("value_invalid_for_operator");
  });

  test("rejects numeric operator with non-number value", () => {
    const r = validateFormatConditions([
      { type: "seeders", operator: "gte", value: "five" },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("value_invalid_for_operator");
  });
});
