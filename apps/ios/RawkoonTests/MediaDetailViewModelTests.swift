import Testing
@testable import Rawkoon

@MainActor
struct MediaDetailViewModelTests {
    /// `LibraryFileInfo` only has a `Decodable` initializer (custom
    /// `init(from:)`), so fixtures are built by decoding JSON rather than a
    /// memberwise initializer.
    private func makeFile(id: Int, season: Int?, episode: Int?, fileName: String) throws -> LibraryFileInfo {
        let json = """
        {
            "id": \(id),
            "fileName": "\(fileName)",
            "filePath": "/library/\(fileName)",
            "sizeBytes": "1000",
            "scannedAt": "2026-01-01T00:00:00Z",
            "season": \(season.map(String.init) ?? "null"),
            "episode": \(episode.map(String.init) ?? "null")
        }
        """
        return try JSONDecoder().decode(LibraryFileInfo.self, from: Data(json.utf8))
    }

    @Test func groupedSeasonFilesSortsBySeasonThenEpisode() throws {
        let vm = MediaDetailViewModel(tmdbId: 1, mediaType: "tv", title: "X", posterPath: nil, libraryId: 10)

        // Deliberately out of order: season 2 before season 1, and within
        // season 1 episode 3 before episode 1 — the old computed var in
        // MediaDetailView grouped by season (via `season ?? 0`) then sorted
        // each group's files by episode number ascending.
        vm.mediaFiles = [
            try makeFile(id: 1, season: 2, episode: 1, fileName: "s02e01.mkv"),
            try makeFile(id: 2, season: 1, episode: 3, fileName: "s01e03.mkv"),
            try makeFile(id: 3, season: 1, episode: 1, fileName: "s01e01.mkv"),
            try makeFile(id: 4, season: nil, episode: nil, fileName: "special.mkv"),
        ]

        let grouped = vm.groupedSeasonFiles

        #expect(grouped.map(\.season) == [0, 1, 2])

        let season0 = grouped.first { $0.season == 0 }
        #expect(season0?.files.map(\.id) == [4])

        let season1 = grouped.first { $0.season == 1 }
        #expect(season1?.files.map(\.id) == [3, 2])

        let season2 = grouped.first { $0.season == 2 }
        #expect(season2?.files.map(\.id) == [1])
    }
}
