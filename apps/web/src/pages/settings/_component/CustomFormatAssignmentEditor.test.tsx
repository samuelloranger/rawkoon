import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  CustomFormatAssignmentEditor,
  type Assignment,
} from "./CustomFormatAssignmentEditor";

// react-i18next is globally mocked in src/test/setup.ts → t(key) returns key

// ─── Mock useCustomFormatsList ────────────────────────────────────────────────

const FORMAT_A = {
  id: 1,
  name: "Dolby Vision",
  conditions: [],
  created_at: "",
  updated_at: "",
};
const FORMAT_B = {
  id: 2,
  name: "Remux Bonus",
  conditions: [],
  created_at: "",
  updated_at: "",
};

vi.mock("@/pages/settings/useCustomFormats", () => ({
  useCustomFormatsList: () => ({
    data: { custom_formats: [FORMAT_A, FORMAT_B] },
  }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderEditor(value: Assignment[], onChange = vi.fn()) {
  return render(
    <CustomFormatAssignmentEditor value={value} onChange={onChange} />,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CustomFormatAssignmentEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. Adding an assignment ───────────────────────────────────────────────

  it("calls onChange with a default assignment when a format is selected from the add selector", () => {
    const onChange = vi.fn();
    renderEditor([], onChange);

    const addSelect = screen.getByRole("combobox", {
      name: /add custom format/i,
    });
    fireEvent.change(addSelect, { target: { value: "1" } });

    expect(onChange).toHaveBeenCalledOnce();
    const next: Assignment[] = onChange.mock.calls[0][0];
    expect(next).toHaveLength(1);
    expect(next[0]).toEqual({
      custom_format_id: 1,
      score: 0,
      required: false,
      forbidden: false,
    });
  });

  // ── 2. Selecting "required" sets required true, forbidden false ────────────

  it("selecting required sets required:true forbidden:false", () => {
    const onChange = vi.fn();
    const initial: Assignment[] = [
      { custom_format_id: 1, score: 10, required: false, forbidden: false },
    ];
    renderEditor(initial, onChange);

    const stanceSelect = screen.getByRole("combobox", {
      name: /stance dolby vision/i,
    });
    fireEvent.change(stanceSelect, { target: { value: "required" } });

    expect(onChange).toHaveBeenCalledOnce();
    const next: Assignment[] = onChange.mock.calls[0][0];
    expect(next[0].required).toBe(true);
    expect(next[0].forbidden).toBe(false);
  });

  // ── 3. Selecting "forbidden" sets forbidden:true, required:false ──────────

  it("selecting forbidden clears required and sets forbidden:true", () => {
    const onChange = vi.fn();
    const initial: Assignment[] = [
      { custom_format_id: 1, score: 5, required: true, forbidden: false },
    ];
    renderEditor(initial, onChange);

    const stanceSelect = screen.getByRole("combobox", {
      name: /stance dolby vision/i,
    });
    fireEvent.change(stanceSelect, { target: { value: "forbidden" } });

    expect(onChange).toHaveBeenCalledOnce();
    const next: Assignment[] = onChange.mock.calls[0][0];
    expect(next[0].forbidden).toBe(true);
    expect(next[0].required).toBe(false);
  });

  // ── 4. Selecting "neither" clears both ───────────────────────────────────

  it("selecting neither clears required and forbidden", () => {
    const onChange = vi.fn();
    const initial: Assignment[] = [
      { custom_format_id: 1, score: 0, required: true, forbidden: false },
    ];
    renderEditor(initial, onChange);

    const stanceSelect = screen.getByRole("combobox", {
      name: /stance dolby vision/i,
    });
    fireEvent.change(stanceSelect, { target: { value: "neither" } });

    expect(onChange).toHaveBeenCalledOnce();
    const next: Assignment[] = onChange.mock.calls[0][0];
    expect(next[0].required).toBe(false);
    expect(next[0].forbidden).toBe(false);
  });

  // ── 5. Editing score ──────────────────────────────────────────────────────

  it("editing the score input calls onChange with updated score", () => {
    const onChange = vi.fn();
    const initial: Assignment[] = [
      { custom_format_id: 1, score: 0, required: false, forbidden: false },
    ];
    renderEditor(initial, onChange);

    const scoreInput = screen.getByRole("spinbutton", {
      name: /score dolby vision/i,
    });
    fireEvent.change(scoreInput, { target: { value: "-50" } });

    expect(onChange).toHaveBeenCalledOnce();
    const next: Assignment[] = onChange.mock.calls[0][0];
    expect(next[0].score).toBe(-50);
  });

  // ── 6. Removing an assignment ─────────────────────────────────────────────

  it("calls onChange without the removed assignment when × is clicked", () => {
    const onChange = vi.fn();
    const initial: Assignment[] = [
      { custom_format_id: 1, score: 0, required: false, forbidden: false },
      { custom_format_id: 2, score: 5, required: false, forbidden: false },
    ];
    renderEditor(initial, onChange);

    const removeBtn = screen.getByRole("button", {
      name: /remove dolby vision/i,
    });
    fireEvent.click(removeBtn);

    expect(onChange).toHaveBeenCalledOnce();
    const next: Assignment[] = onChange.mock.calls[0][0];
    expect(next).toHaveLength(1);
    expect(next[0].custom_format_id).toBe(2);
  });

  // ── 7. Add selector hides already-assigned formats ────────────────────────

  it("does not show already-assigned formats in the add dropdown", () => {
    const initial: Assignment[] = [
      { custom_format_id: 1, score: 0, required: false, forbidden: false },
    ];
    renderEditor(initial);

    const addSelect = screen.getByRole("combobox", {
      name: /add custom format/i,
    });
    const options = Array.from(addSelect.querySelectorAll("option")).map(
      (o) => o.value,
    );
    // Format 1 (id=1) is assigned — should not appear; format 2 (id=2) should
    expect(options).not.toContain("1");
    expect(options).toContain("2");
  });
});
