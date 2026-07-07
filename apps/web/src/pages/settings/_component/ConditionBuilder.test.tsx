import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConditionBuilder } from "./ConditionBuilder";
import type { CustomFormatCondition } from "@rawkoon/shared/types";

// react-i18next is globally mocked in src/test/setup.ts → t(key) returns key

function renderBuilder(
  conditions: CustomFormatCondition[],
  onChange = vi.fn(),
) {
  return render(
    <ConditionBuilder conditions={conditions} onChange={onChange} />,
  );
}

describe("ConditionBuilder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. Row count ──────────────────────────────────────────────────────────

  it("renders one row per condition", () => {
    const conditions: CustomFormatCondition[] = [
      { type: "title_regex", operator: "matches", value: "foo" },
      { type: "source", operator: "equals", value: "BluRay" },
    ];
    renderBuilder(conditions);
    // Each row has a remove button
    expect(
      screen.getAllByRole("button", { name: /remove condition/i }),
    ).toHaveLength(2);
  });

  // ── 2. size_range + between → two number inputs ───────────────────────────

  it("shows TWO number inputs when type=size_range and operator=between", () => {
    const conditions: CustomFormatCondition[] = [
      { type: "size_range", operator: "between", value: [1, 5] },
    ];
    renderBuilder(conditions);
    const numberInputs = screen
      .getAllByRole("spinbutton")
      .filter((el) => el instanceof HTMLInputElement);
    expect(numberInputs).toHaveLength(2);
  });

  // ── 3. hdr_flag → no value input and operator is is_true ────────────────

  it("shows NO value input and is_true for hdr_flag", () => {
    const conditions: CustomFormatCondition[] = [
      { type: "hdr_flag", operator: "is_true" },
    ];
    renderBuilder(conditions);
    // No text or number input visible
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    // Operator select shows only is_true option
    const opSelects = screen.getAllByRole("combobox", {
      name: /condition operator/i,
    });
    expect(opSelects[0]).toBeDisabled();
    // The single option is the is_true key
    expect(opSelects[0]).toHaveValue("is_true");
  });

  // ── 4. source limits operator to equals ──────────────────────────────────

  it("limits operator options to equals for source type", () => {
    const conditions: CustomFormatCondition[] = [
      { type: "source", operator: "equals", value: "BluRay" },
    ];
    renderBuilder(conditions);
    const opSelect = screen.getByRole("combobox", {
      name: /condition operator/i,
    });
    const options = Array.from(opSelect.querySelectorAll("option")).map(
      (o) => o.value,
    );
    expect(options).toEqual(["equals"]);
    expect(opSelect).toBeDisabled();
  });

  // ── 5. Invalid regex indicator ────────────────────────────────────────────

  it("surfaces the invalid-regex indicator on a bad regex pattern", () => {
    const conditions: CustomFormatCondition[] = [
      { type: "title_regex", operator: "matches", value: "[invalid" },
    ];
    renderBuilder(conditions);
    // The indicator has aria-label="invalid regex"
    expect(screen.getByLabelText("invalid regex")).toBeInTheDocument();
  });

  it("shows the valid-regex indicator on a valid regex pattern", () => {
    const conditions: CustomFormatCondition[] = [
      { type: "title_regex", operator: "matches", value: "^foo.*bar$" },
    ];
    renderBuilder(conditions);
    expect(screen.getByLabelText("valid regex")).toBeInTheDocument();
  });

  // ── 6. Add condition ──────────────────────────────────────────────────────

  it("calls onChange with an appended default condition when Add is clicked", () => {
    const onChange = vi.fn();
    const existing: CustomFormatCondition[] = [
      { type: "source", operator: "equals", value: "WEB-DL" },
    ];
    renderBuilder(existing, onChange);

    fireEvent.click(
      screen.getByRole("button", { name: /customFormats.addCondition/i }),
    );

    expect(onChange).toHaveBeenCalledOnce();
    const next: CustomFormatCondition[] = onChange.mock.calls[0][0];
    expect(next).toHaveLength(2);
    expect(next[1]).toEqual({
      type: "title_regex",
      operator: "matches",
      value: "",
    });
  });

  // ── 7. Remove condition ───────────────────────────────────────────────────

  it("calls onChange without the removed row when × is clicked", () => {
    const onChange = vi.fn();
    const conditions: CustomFormatCondition[] = [
      { type: "title_regex", operator: "matches", value: "foo" },
      { type: "source", operator: "equals", value: "BluRay" },
    ];
    renderBuilder(conditions, onChange);

    const removeBtns = screen.getAllByRole("button", {
      name: /remove condition/i,
    });
    fireEvent.click(removeBtns[0]); // remove first row

    expect(onChange).toHaveBeenCalledOnce();
    const next: CustomFormatCondition[] = onChange.mock.calls[0][0];
    expect(next).toHaveLength(1);
    expect(next[0].type).toBe("source");
  });

  // ── 8. Changing type resets operator and value ────────────────────────────

  it("resets operator and value when type changes", () => {
    const onChange = vi.fn();
    const conditions: CustomFormatCondition[] = [
      { type: "title_regex", operator: "matches", value: "foo" },
    ];
    renderBuilder(conditions, onChange);

    const typeSelect = screen.getByRole("combobox", {
      name: /condition type/i,
    });
    fireEvent.change(typeSelect, { target: { value: "hdr_flag" } });

    expect(onChange).toHaveBeenCalledOnce();
    const next: CustomFormatCondition[] = onChange.mock.calls[0][0];
    expect(next[0].type).toBe("hdr_flag");
    expect(next[0].operator).toBe("is_true");
    expect(next[0].value).toBeUndefined();
  });

  it("resets to first numeric operator when switching to resolution", () => {
    const onChange = vi.fn();
    const conditions: CustomFormatCondition[] = [
      { type: "title_regex", operator: "matches", value: "foo" },
    ];
    renderBuilder(conditions, onChange);

    const typeSelect = screen.getByRole("combobox", {
      name: /condition type/i,
    });
    fireEvent.change(typeSelect, { target: { value: "resolution" } });

    expect(onChange).toHaveBeenCalledOnce();
    const next: CustomFormatCondition[] = onChange.mock.calls[0][0];
    expect(next[0].type).toBe("resolution");
    // first valid op for resolution is "gte"
    expect(next[0].operator).toBe("gte");
    // default value for numeric single op
    expect(next[0].value).toBe("");
  });

  // ── 9. Operator between converts value to [n, n] ─────────────────────────

  it("converts value to [n, n] when switching operator to between", () => {
    const onChange = vi.fn();
    const conditions: CustomFormatCondition[] = [
      { type: "seeders", operator: "gte", value: 3 },
    ];
    renderBuilder(conditions, onChange);

    const opSelect = screen.getByRole("combobox", {
      name: /condition operator/i,
    });
    fireEvent.change(opSelect, { target: { value: "between" } });

    expect(onChange).toHaveBeenCalledOnce();
    const next: CustomFormatCondition[] = onChange.mock.calls[0][0];
    expect(next[0].operator).toBe("between");
    expect(Array.isArray(next[0].value)).toBe(true);
    const [min, max] = next[0].value as [number, number];
    expect(min).toBe(3);
    expect(max).toBe(3);
  });
});
