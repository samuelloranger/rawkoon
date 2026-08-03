import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConfirmProvider } from "@/components/confirm/ConfirmContext";
import { MergedEpisodeRow } from "./LibraryMergedEpisodeRow";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

function mutStub() {
  return {
    isPending: false,
    mutateAsync: vi.fn(),
  } as never;
}

/**
 * Regression for the screenshot-era report that a season mixing downloaded
 * past episodes with wanted+future airDate rows hard-crashed Chromium via an
 * SPA render loop. Current UI must render that shape without throwing.
 */
describe("MergedEpisodeRow mixed-status season", () => {
  it("renders downloaded past and wanted future siblings together", () => {
    const past = "2020-01-15";
    const future = "2099-12-01";

    const { container } = render(
      <ConfirmProvider>
        <MergedEpisodeRow
          ep={{
            id: 1,
            episode: 1,
            title: "Downloaded past",
            air_date: past,
            status: "downloaded",
            monitored: true,
            search_attempts: 0,
          }}
          season={2}
          file={null}
          libraryId={1}
          t={(k) => k}
          searchEpMut={mutStub()}
          retryEpMut={mutStub()}
          toggleMonitoredMut={mutStub()}
          deleteEpisodeMut={mutStub()}
        />
        <MergedEpisodeRow
          ep={{
            id: 4,
            episode: 4,
            title: "Wanted future",
            air_date: future,
            status: "wanted",
            monitored: true,
            search_attempts: 0,
          }}
          season={2}
          file={null}
          libraryId={1}
          t={(k) => k}
          searchEpMut={mutStub()}
          retryEpMut={mutStub()}
          toggleMonitoredMut={mutStub()}
          deleteEpisodeMut={mutStub()}
        />
      </ConfirmProvider>,
    );

    expect(screen.getAllByText("Downloaded past").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Wanted future").length).toBeGreaterThan(0);
    expect(screen.getAllByText("E01").length).toBeGreaterThan(0);
    expect(screen.getAllByText("E04").length).toBeGreaterThan(0);
    // Future air date is shown for the wanted row (formatDateShort).
    expect(container.textContent).toMatch(/Dec/);
  });
});
