import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ExtensionChipInput } from "./ExtensionChipInput";

describe("ExtensionChipInput", () => {
  it("adds on Enter or comma, normalizing and de-duplicating", () => {
    const onChange = vi.fn();
    render(<ExtensionChipInput value={["exe"]} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: ".ISO" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith(["exe", "iso"]);
    fireEvent.change(input, { target: { value: "exe" } });
    fireEvent.keyDown(input, { key: "," });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
  it("removes with the chip button and with Backspace on an empty input", () => {
    const onChange = vi.fn();
    render(<ExtensionChipInput value={["exe", "lnk"]} onChange={onChange} />);
    fireEvent.click(
      screen.getByRole("button", {
        name: /^settings\.downloadSafety\.remove ext:exe/,
      }),
    );
    expect(onChange).toHaveBeenLastCalledWith(["lnk"]);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Backspace" });
    expect(onChange).toHaveBeenLastCalledWith(["exe"]);
  });
  it("flags invalid input instead of adding it", () => {
    const onChange = vi.fn();
    render(<ExtensionChipInput value={[]} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "tar.gz" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.getByText("settings.downloadSafety.invalid"),
    ).toBeInTheDocument();
  });
});
