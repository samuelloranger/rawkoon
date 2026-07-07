import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

import {
  useDiscoverPageState,
  DISCOVER_DEFAULTS,
} from "./useDiscoverPageState";

beforeEach(() => {
  mockNavigate.mockClear();
});

describe("useDiscoverPageState", () => {
  it("merges empty search onto defaults", () => {
    const { result } = renderHook(() => useDiscoverPageState({}));
    expect(result.current.state).toEqual(DISCOVER_DEFAULTS);
  });

  it("overrides defaults with provided search params", () => {
    const { result } = renderHook(() =>
      useDiscoverPageState({ type: "tv", genre: 28, page: 3 }),
    );
    expect(result.current.state.type).toBe("tv");
    expect(result.current.state.genre).toBe(28);
    expect(result.current.state.page).toBe(3);
    expect(result.current.state.sort).toBe("popularity.desc");
  });

  it("setState navigates with only non-default params", () => {
    const { result } = renderHook(() => useDiscoverPageState({}));
    act(() => {
      result.current.setState({ genre: 28, page: 2 });
    });
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/explore/",
      search: { genre: 28, page: 2 },
      replace: false,
      resetScroll: false,
    });
  });
});
