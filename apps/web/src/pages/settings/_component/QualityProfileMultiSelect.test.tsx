import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MultiSelect } from "./QualityProfileMultiSelect";

const OPTIONS = [
  { value: "REMUX", label: "REMUX" },
  { value: "BluRay", label: "Blu-ray" },
  { value: "WEB-DL", label: "WEB-DL" },
];

function renderOrderable(selected: string[], onChange = vi.fn()) {
  render(
    <MultiSelect
      label="Preferred sources"
      placeholder="Select sources…"
      options={OPTIONS}
      selected={selected}
      onChange={onChange}
      orderable
      rankLabel={(i) => `+${800 - i * 200}`}
    />,
  );
  return onChange;
}

const upLabel = "settings.qualityProfiles.movePriorityUp";
const downLabel = "settings.qualityProfiles.movePriorityDown";
const removeLabel = "settings.qualityProfiles.removeSelection";

describe("MultiSelect — orderable", () => {
  it("renders the selection in array order with its rank and score", () => {
    renderOrderable(["BluRay", "WEB-DL"]);
    expect(screen.getByText("#1").parentElement).toHaveTextContent("Blu-ray");
    expect(screen.getByText("#2").parentElement).toHaveTextContent("WEB-DL");
    expect(screen.getByText("+800")).toBeInTheDocument();
    expect(screen.getByText("+600")).toBeInTheDocument();
  });

  it("moves an entry up, changing which source outranks the other", () => {
    const onChange = renderOrderable(["WEB-DL", "BluRay"]);
    fireEvent.click(screen.getAllByLabelText(upLabel)[1]);
    expect(onChange).toHaveBeenCalledWith(["BluRay", "WEB-DL"]);
  });

  it("moves an entry down", () => {
    const onChange = renderOrderable(["BluRay", "WEB-DL"]);
    fireEvent.click(screen.getAllByLabelText(downLabel)[0]);
    expect(onChange).toHaveBeenCalledWith(["WEB-DL", "BluRay"]);
  });

  it("disables up on the first row and down on the last", () => {
    renderOrderable(["BluRay", "WEB-DL"]);
    expect(screen.getAllByLabelText(upLabel)[0]).toBeDisabled();
    expect(screen.getAllByLabelText(downLabel)[1]).toBeDisabled();
  });

  it("removes an entry without disturbing the rest of the order", () => {
    const onChange = renderOrderable(["REMUX", "BluRay", "WEB-DL"]);
    fireEvent.click(screen.getAllByLabelText(removeLabel)[1]);
    expect(onChange).toHaveBeenCalledWith(["REMUX", "WEB-DL"]);
  });

  it("summarises the selection on the trigger instead of inline chips", () => {
    renderOrderable(["BluRay", "WEB-DL"]);
    expect(
      screen.getByText("settings.qualityProfiles.selectedCount count:2"),
    ).toBeInTheDocument();
  });
});

describe("MultiSelect — default (unordered)", () => {
  it("still renders inline chips and no reorder controls", () => {
    render(
      <MultiSelect
        label="Preferred sources"
        placeholder="Select sources…"
        options={OPTIONS}
        selected={["BluRay", "WEB-DL"]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Blu-ray")).toBeInTheDocument();
    expect(screen.queryByLabelText(upLabel)).not.toBeInTheDocument();
    expect(screen.queryByText("#1")).not.toBeInTheDocument();
  });
});
