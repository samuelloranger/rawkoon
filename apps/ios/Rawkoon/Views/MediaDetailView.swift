import SwiftUI

// STUB — replaced by the media-detail page implementation.
// Pushed from Discover and Library. `mediaType` is TMDB-style ("movie"/"tv").
// `libraryId` is non-nil when the title is already in the library.
struct MediaDetailView: View {
    @EnvironmentObject private var model: AppModel

    let tmdbId: Int
    let mediaType: String
    let title: String
    let posterPath: String?
    let libraryId: Int?

    init(tmdbId: Int, mediaType: String, title: String, posterPath: String?, libraryId: Int?) {
        self.tmdbId = tmdbId
        self.mediaType = mediaType
        self.title = title
        self.posterPath = posterPath
        self.libraryId = libraryId
    }

    var body: some View {
        ScrollView {
            Text(title)
                .font(.display(22))
                .foregroundStyle(Theme.textStrong)
                .padding(.top, 80)
        }
        .background(Theme.base)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }
}
