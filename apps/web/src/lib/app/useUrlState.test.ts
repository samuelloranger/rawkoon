import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));

import { useUrlState } from "./useUrlState";

const defaults = { q: "", type: "all" };

describe("useUrlState.setState", () => {
  it("pushes a history entry by default", () => {
    const { result } = renderHook(() => useUrlState("/x", {}, defaults));
    result.current.setState({ type: "movie" });
    expect(navigate).toHaveBeenLastCalledWith(
      expect.objectContaining({ replace: false, search: { type: "movie" } }),
    );
  });

  it("replaces the entry when asked, so typing does not stack history", () => {
    const { result } = renderHook(() => useUrlState("/x", {}, defaults));
    result.current.setState({ q: "al" }, { replace: true });
    expect(navigate).toHaveBeenLastCalledWith(
      expect.objectContaining({ replace: true, search: { q: "al" } }),
    );
  });
});
