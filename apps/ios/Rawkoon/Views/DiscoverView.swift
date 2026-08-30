import SwiftUI

// STUB — replaced by the Discover page implementation.
// Tab root. Explore feed + TMDB search + poster grid; tap → MediaDetailView.
struct DiscoverView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        ScrollView {
            ContentUnavailableView(
                "Discover",
                systemImage: "sparkles.rectangle.stack",
                description: Text("Browse and request movies, shows, and books.")
            )
            .padding(.top, 80)
        }
        .background(Theme.base)
        .navigationTitle("Discover")
    }
}
