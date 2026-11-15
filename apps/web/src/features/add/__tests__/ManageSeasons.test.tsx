import { describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "@/test-utils/render";
import type { LibraryEpisodesResponse } from "@rawkoon/shared/types";
import { ManageSeasons } from "../ManageSeasons";

const ep = (season: number, episode: number, monitored: boolean) => ({
  id: season * 100 + episode,
  season,
  episode,
  title: null,
  air_date: "2020-01-01",
  status: "wanted" as const,
  monitored,
  tmdb_episode_id: null,
  downloaded_at: null,
  search_attempts: 0,
});
const episodes = {
  seasons: [
    { season: 1, episodes: [ep(1, 1, false), ep(1, 2, false)] },
    { season: 2, episodes: [ep(2, 1, true), ep(2, 2, true)] },
  ],
} as unknown as LibraryEpisodesResponse;

const fetcher = vi.fn((url: string) =>
  Promise.resolve(
    url.endsWith("/monitored-seasons")
      ? { monitor_new_seasons: true }
      : { item: { id: 5, monitor_new_seasons: true } },
  ),
);

describe("ManageSeasons", () => {
  it("shows the monitored seasons and only offers Save once something changes", async () => {
    renderWithProviders(<ManageSeasons libraryId={5} episodes={episodes} />, {
      fetcher,
    });
    const s1 = screen.getByRole("button", {
      name: "addDialog.seasonLabel n:1",
    });
    const s2 = screen.getByRole("button", {
      name: "addDialog.seasonLabel n:2",
    });
    expect(s1).toHaveAttribute("aria-pressed", "false");
    expect(s2).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("addDialog.manage.save")).not.toBeInTheDocument();

    fireEvent.click(s1);
    fireEvent.click(screen.getByText("addDialog.manage.save"));
    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        "/api/library/5/monitored-seasons",
        expect.objectContaining({
          method: "PATCH",
          body: {
            season_mode: "pick",
            seasons: [1, 2],
            monitor_new_seasons: true,
          },
        }),
      ),
    );
  });

  it("Reset drops the change and hides Save and Reset again", () => {
    renderWithProviders(<ManageSeasons libraryId={5} episodes={episodes} />, {
      fetcher,
    });
    fireEvent.click(
      screen.getByRole("button", { name: "addDialog.seasonLabel n:1" }),
    );
    fireEvent.click(screen.getByText("addDialog.manage.reset"));
    expect(screen.queryByText("addDialog.manage.save")).not.toBeInTheDocument();
  });
});
