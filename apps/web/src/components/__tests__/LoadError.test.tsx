import { describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen, fireEvent } from "@/test-utils/render";
import { HttpError } from "@/lib/api/httpClient";
import { LoadError, isNotFoundError } from "../LoadError";

describe("LoadError", () => {
  it("retries on click", () => {
    const onRetry = vi.fn();
    renderWithProviders(<LoadError onRetry={onRetry} />);
    fireEvent.click(screen.getByText("common.retry"));
    expect(onRetry).toHaveBeenCalled();
  });

  it("only treats a 404 as not found", () => {
    expect(isNotFoundError(new HttpError("x", 404))).toBe(true);
    expect(isNotFoundError(new HttpError("x", 500))).toBe(false);
    expect(isNotFoundError(new TypeError("network"))).toBe(false);
  });
});
