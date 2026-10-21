import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MediaPostProcessingSettings } from "@rawkoon/shared/types";

const mutateAsync = vi.fn(async (_body: Record<string, unknown>) => ({}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/medias/hooks/useUpdateMediaPostProcessingSettings", () => ({
  useUpdateMediaPostProcessingSettings: () => ({
    mutateAsync,
    isPending: false,
  }),
}));
vi.mock("@/features/medias/hooks/useLibraryScan", () => ({
  useLibraryScan: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/features/medias/hooks/useReindexLanguages", () => ({
  useReindexLanguages: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/features/medias/hooks/useReindexLanguagesStatus", () => ({
  useReindexLanguagesStatus: () => ({ data: undefined }),
}));
vi.mock("@/pages/books/_hooks/useBooks", () => ({
  useBookQualityProfiles: () => ({
    data: { profiles: [{ id: 5, name: "Book profile" }] },
  }),
}));
vi.mock("@/pages/settings/_component/ReleaseCheckFieldset", () => ({
  ReleaseCheckFieldset: () => <div>release-check</div>,
}));

import { MediaPostProcessingSettingsBody } from "../MediaPostProcessingSettingsBody";

const settings = {
  post_processing_enabled: true,
  movies_library_path: "/m",
  shows_library_path: "/s",
  downloads_path: "/d",
  file_operation: "hardlink",
  movie_template: "{title}",
  episode_template: "{title}",
  default_movie_quality_profile_id: 1,
  default_show_quality_profile_id: null,
  default_book_quality_profile_id: 5,
  search_on_add: true,
  release_check_cron: "0 */6 * * *",
  rss_poll_interval_minutes: 15,
  active_indexer_manager: "prowlarr",
  updated_at: "x",
} as unknown as MediaPostProcessingSettings;

const profilesData = {
  profiles: [
    { id: 1, name: "Movie profile" },
    { id: 2, name: "Show profile" },
  ],
} as never;

describe("library settings", () => {
  it("has a Defaults block with the movie, show and book profiles", () => {
    render(
      <MediaPostProcessingSettingsBody
        settings={settings}
        profilesData={profilesData}
      />,
    );
    expect(screen.getByText("settings.library.defaults.title")).toBeTruthy();
    for (const id of ["movie", "show", "book"]) {
      expect(
        document.getElementById(
          `media-post-processing-settings-body-default-${id}-quality-profile-id`,
        ),
      ).not.toBeNull();
    }
  });

  it("no longer carries the indexer manager select or the readiness checklist", () => {
    render(
      <MediaPostProcessingSettingsBody
        settings={settings}
        profilesData={profilesData}
      />,
    );
    expect(
      document.getElementById(
        "media-post-processing-settings-body-active-indexer-manager",
      ),
    ).toBeNull();
    expect(document.getElementById("grab-readiness")).toBeNull();
  });

  it("keeps naming templates behind Advanced", () => {
    render(
      <MediaPostProcessingSettingsBody
        settings={settings}
        profilesData={profilesData}
      />,
    );
    const template = document.getElementById(
      "media-post-processing-settings-body-movie-template",
    );
    expect(template?.closest("details")?.open).toBe(false);
  });

  it("saves the book default without touching the active indexer manager", async () => {
    mutateAsync.mockClear();
    render(
      <MediaPostProcessingSettingsBody
        settings={settings}
        profilesData={profilesData}
      />,
    );
    fireEvent.click(screen.getByText("settings.mediaLibrary.save"));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    const body = mutateAsync.mock.calls[0][0];
    expect(body.default_book_quality_profile_id).toBe(5);
    expect("active_indexer_manager" in body).toBe(false);
  });

  it("saves the RSS poll interval picked from the offered intervals", async () => {
    mutateAsync.mockClear();
    render(
      <MediaPostProcessingSettingsBody
        settings={settings}
        profilesData={profilesData}
      />,
    );
    const select = document.getElementById(
      "media-post-processing-settings-body-rss-poll-interval",
    ) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual([
      "5",
      "10",
      "15",
      "30",
      "60",
    ]);
    expect(select.value).toBe("15");
    fireEvent.change(select, { target: { value: "5" } });
    fireEvent.click(screen.getByText("settings.mediaLibrary.save"));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(mutateAsync.mock.calls[0][0].rss_poll_interval_minutes).toBe(5);
  });

  it("warns about Jackett's feed cache only when Jackett is the indexer manager", () => {
    const { unmount } = render(
      <MediaPostProcessingSettingsBody
        settings={settings}
        profilesData={profilesData}
      />,
    );
    expect(
      screen.queryByText("settings.mediaLibrary.rssPoll.jackettCache"),
    ).toBeNull();
    unmount();
    render(
      <MediaPostProcessingSettingsBody
        settings={{ ...settings, active_indexer_manager: "jackett" }}
        profilesData={profilesData}
      />,
    );
    expect(
      screen.getByText("settings.mediaLibrary.rssPoll.jackettCache"),
    ).toBeTruthy();
  });
});
