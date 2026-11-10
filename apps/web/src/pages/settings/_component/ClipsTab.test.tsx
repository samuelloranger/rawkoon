import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils/render";

const state = vi.hoisted(() => ({ enabled: false }));
const update = vi.fn();
const deleteAll = vi.fn(async () => ({ deleted_files: 3, freed_bytes: 3e6 }));
const retry = vi.fn();

vi.mock("@/features/clips/hooks", () => ({
  useClipProgress: () => ({
    data: {
      settings: { enabled: state.enabled, paused: false },
      done: 12,
      left: 4,
      failed: 1,
      total_bytes: 3_000_000,
      running: { clip_id: 1, kind: "season", title: "Show", season_number: 2 },
      eta_seconds: 300,
      failed_items: [
        {
          clip_id: 9,
          kind: "movie",
          title: "Film",
          season_number: null,
          error: "boom",
        },
      ],
    },
  }),
  useUpdateClipSettings: () => ({ mutate: update }),
  useClipActions: () => ({
    retry: { mutate: retry, isPending: false },
    deleteAll: { mutateAsync: deleteAll, isPending: false },
  }),
}));

const { ClipsTab } = await import("@/pages/settings/_component/ClipsTab");

describe("ClipsTab", () => {
  it("renders stats, the running clip and failures", () => {
    renderWithProviders(<ClipsTab />);
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText(/Show · clips.admin.season/)).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("disables Delete all while clips are enabled", () => {
    state.enabled = true;
    renderWithProviders(<ClipsTab />);
    expect(
      screen.getByRole("button", { name: "clips.admin.deleteAll.button" }),
    ).toBeDisabled();
    expect(
      screen.getByText("clips.admin.deleteAll.turnOffFirst"),
    ).toBeInTheDocument();
  });

  it("confirms before deleting when clips are off", async () => {
    state.enabled = false;
    renderWithProviders(<ClipsTab />);
    fireEvent.click(
      screen.getByRole("button", { name: "clips.admin.deleteAll.button" }),
    );
    expect(deleteAll).not.toHaveBeenCalled();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "clips.admin.deleteAll.confirm",
      }),
    );
    await waitFor(() => expect(deleteAll).toHaveBeenCalled());
  });

  it("toggles enabled and retries failures", () => {
    state.enabled = false;
    renderWithProviders(<ClipsTab />);
    fireEvent.click(screen.getByRole("switch"));
    expect(update).toHaveBeenCalledWith({ enabled: true }, expect.anything());
    fireEvent.click(
      screen.getByRole("button", { name: "clips.admin.retryFailed" }),
    );
    expect(retry).toHaveBeenCalled();
  });
});
