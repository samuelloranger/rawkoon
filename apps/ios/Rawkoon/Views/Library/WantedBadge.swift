import RawkoonKit
import SwiftUI

/// Says why a wanted title is still wanted: a miss gets words, the rest a glyph with a spoken label.
struct WantedBadge: View {
    let media: LibraryMedia

    var body: some View {
        let note = media.lastSearchNote
        if let releaseDay = media.upcomingReleaseDay {
            let date = UpcomingRelease.format(releaseDay)
            Label(date, systemImage: "calendar")
                .labelStyle(.titleAndIcon)
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(Theme.base)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(Theme.muted.opacity(0.9), in: Capsule())
                .accessibilityElement()
                .accessibilityLabel(Text("Releases \(date)"))
        } else if note?.outcome == .noMatch {
            Text("No match")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(Theme.base)
                .lineLimit(1)
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(Theme.terracotta, in: Capsule())
        } else {
            let glyph = glyph(note: note)
            Circle().fill(Theme.muted.opacity(0.9)).frame(width: 22, height: 22)
                .overlay(
                    Image(systemName: glyph.symbol)
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(Theme.base)
                )
                .accessibilityElement()
                .accessibilityLabel(glyph.label)
        }
    }

    private func glyph(note: LastSearchNote?) -> (symbol: String, label: LocalizedStringKey) {
        switch note?.outcome {
        case .delayed: ("clock", "Held by the grab delay")
        case .notReleased: ("calendar", "Not released yet")
        case .error: ("exclamationmark", "Search failed")
        default: media.status == "missing" ? ("exclamationmark", "Missing") : ("hourglass", "Wanted")
        }
    }
}
