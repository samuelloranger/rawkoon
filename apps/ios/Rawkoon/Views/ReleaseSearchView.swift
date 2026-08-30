import SwiftUI

// STUB — replaced by the release-search sheet implementation.
// Presented as a sheet from MediaDetailView. Interactive indexer search + grab.
struct ReleaseSearchView: View {
    @EnvironmentObject private var model: AppModel

    let query: String
    let libraryMediaId: Int?
    let tmdbId: Int?
    let mediaType: String

    init(query: String, libraryMediaId: Int?, tmdbId: Int?, mediaType: String) {
        self.query = query
        self.libraryMediaId = libraryMediaId
        self.tmdbId = tmdbId
        self.mediaType = mediaType
    }

    var body: some View {
        Text("Releases")
            .font(.display(20))
            .foregroundStyle(Theme.textStrong)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.base)
    }
}
