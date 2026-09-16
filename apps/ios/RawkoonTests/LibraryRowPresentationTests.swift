@testable import Rawkoon
import SwiftUI
import Testing

@MainActor
struct LibraryRowPresentationTests {
    @Test func provisionalRowIsNotInteractiveAndSaysAdding() {
        let presentation = LibraryRowPresentation(media: provisional(tmdbId: 7))

        #expect(presentation.status == .adding)
        #expect(presentation.isInteractive == false)
        #expect(presentation.showsSpinner)
    }

    @Test func confirmedRowKeepsItsServerStatusAndStaysInteractive() {
        let presentation = LibraryRowPresentation(media: movie(id: 1, status: "downloaded"))

        #expect(presentation.status == .server("downloaded"))
        #expect(presentation.isInteractive)
        #expect(presentation.showsSpinner == false)
    }

    @Test func busyConfirmedRowSpinsButStaysInteractive() {
        let presentation = LibraryRowPresentation(media: movie(id: 1, status: "wanted"), isBusy: true)

        #expect(presentation.isInteractive)
        #expect(presentation.showsSpinner)
    }

    /// The provisional row's id is a negative placeholder, so nothing that
    /// addresses the server may be reachable from it.
    @Test func provisionalRowCarriesNoUsableLibraryId() {
        let row = provisional(tmdbId: 7)

        #expect(row.id < 0)
        #expect(LibraryRowPresentation(media: row).isInteractive == false)
    }

    // MARK: Rendering

    // Forcing a real render pass evaluates the view's body, which is what the
    // pure presentation checks above cannot reach.

    @Test func provisionalRowRendersAndDiffersFromAConfirmedRow() throws {
        let pending = try render(row(for: provisional(tmdbId: 7)))
        let confirmed = try render(row(for: movie(id: 7, status: "wanted")))

        #expect(pending.size.width > 0)
        #expect(pending.pngData() != confirmed.pngData())
    }

    @Test func libraryMediaRowRendersEveryStatusItCanReceive() throws {
        for status in ["wanted", "missing", "downloading", "downloaded"] {
            let image = try render(row(for: movie(id: 1, status: status)))
            #expect(image.size.height > 0)
        }
    }

    private func row(for media: LibraryMedia) -> some View {
        LibraryMediaRow(
            media: media,
            posterURL: nil,
            isBusy: false,
            menuItems: [],
            onMenuAction: { _ in }
        )
        .frame(width: 320)
    }

    private func render(_ view: some View) throws -> UIImage {
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        return try #require(renderer.uiImage)
    }

    private func provisional(tmdbId: Int) -> LibraryMedia {
        LibraryMedia.provisional(tmdbId: tmdbId, type: "movie", title: "Movie \(tmdbId)", year: 2026, posterUrl: nil, overview: nil)
    }

    private func movie(id: Int, status: String) -> LibraryMedia {
        LibraryMedia(
            id: id, tmdbId: id, type: "movie", title: "Movie \(id)", year: 2026,
            status: status, monitored: true, posterUrl: nil, overview: nil,
            qualityProfileId: nil, qualityProfile: nil, totalSizeBytes: nil,
            episodeCount: nil, downloadedEpisodeCount: nil, seasonCount: nil,
            durationSecs: nil, resolution: nil, videoCodec: nil, hdrFormat: nil,
            audioFormat: nil, languageTags: nil, lastGrabbedAt: nil, addedAt: nil,
            digitalReleaseDate: nil
        )
    }
}
