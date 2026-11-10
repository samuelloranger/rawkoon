import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils/render";

const state = vi.hoisted(() => ({ admin: true, enabled: true }));
const mutate = vi.fn();
const clip = {
  id: 7,
  kind: "season",
  media_id: 1,
  season_number: 2,
  status: "done",
  start_sec: 90,
  manual_start: false,
  bytes: 1,
  error: null,
  updated_at: "2026-01-01T00:00:00Z",
};

vi.mock("@/lib/auth/useAuth", () => ({
  useCurrentUser: () => ({ data: { is_admin: state.admin } }),
}));
vi.mock("@/features/clips/hooks", () => ({
  useClipSettings: () => ({ data: { enabled: state.enabled, paused: false } }),
  useMediaClips: () => ({ data: [clip] }),
  useRecutClip: () => ({ mutate, isPending: false }),
}));
vi.mock("@/features/medias/hooks/useLibraryItem", () => ({
  useLibraryItem: () => ({ data: { item: { tmdb_id: 5, type: "show" } } }),
}));

const { ClipPanel } = await import("./ClipPanel");

describe("ClipPanel", () => {
  it("hides for non-admins and when clips are off", () => {
    state.admin = false;
    const a = renderWithProviders(<ClipPanel libraryId={1} season={2} />);
    expect(a.container).toBeEmptyDOMElement();
    state.admin = true;
    state.enabled = false;
    const b = renderWithProviders(<ClipPanel libraryId={1} season={2} />);
    expect(b.container).toBeEmptyDOMElement();
  });

  it("re-cuts at the parsed time and rejects bad input", () => {
    state.enabled = true;
    const { container } = renderWithProviders(
      <ClipPanel libraryId={1} season={2} />,
    );
    expect(container.querySelector("video")?.getAttribute("src")).toContain(
      "tmdbId=5&type=show&season=2",
    );
    const input = screen.getByLabelText("clips.panel.startLabel");
    const button = screen.getByRole("button", { name: "clips.panel.recut" });
    fireEvent.change(input, { target: { value: "1:75" } });
    fireEvent.click(button);
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText("clips.panel.invalid")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "2:05" } });
    fireEvent.click(button);
    expect(mutate).toHaveBeenCalledWith(
      { id: 7, start_sec: 125 },
      expect.anything(),
    );
  });
});
