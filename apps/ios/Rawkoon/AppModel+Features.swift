import Foundation

extension AppModel {
    /// Paints the saved flag first so an offline launch hides Books too, then refreshes it from the server.
    func refreshBooksEnabled() async {
        guard let client = api() else { return }
        if let cached = client.cached(Endpoints.systemFeatures) {
            apply(cached.value)
        }
        if let features = try? await client.systemFeatures() {
            apply(features)
        }
    }

    private func apply(_ features: SystemFeatures) {
        booksEnabled = features.booksEnabled
        askBeforeAdding = features.askBeforeAdding ?? false
        requestersChooseSeasons = features.requestersChooseSeasons ?? false
    }
}
