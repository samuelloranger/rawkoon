import RawkoonKit
import SwiftUI

/// Home dashboard widget: listening streak, week hours, and active series.
/// Self-loads and hides when books are disabled or the fetch fails.
struct ListeningStatsCard: View {
    @Environment(AppModel.self) private var model

    var refreshToken: Int = 0

    @State private var stats: ListeningStats?
    @State private var booksEnabled = true

    var body: some View {
        Group {
            if booksEnabled, let stats {
                NavigationLink {
                    ListeningStatsView(stats: stats)
                } label: {
                    card(stats)
                }
                .buttonStyle(.plain)
            } else {
                Color.clear.frame(width: 0, height: 0)
            }
        }
        .task(id: refreshToken) { await load() }
    }

    private func card(_ stats: ListeningStats) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Listening", systemImage: "headphones")
                .font(.display(16))
                .foregroundStyle(Theme.textStrong)

            ListeningStatsFigures(stats: stats)

            if let series = stats.series.first(where: { $0.currentTitle != nil }) {
                Text(verbatim: "\(series.name) · \(series.percent)%")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
            }

            if stats.since == nil {
                Text("Hours start now — listen and they'll add up.")
                    .font(.caption)
                    .foregroundStyle(Theme.faint)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Theme.border, lineWidth: 1))
    }

    private func load() async {
        guard let client = model.api() else {
            stats = nil
            return
        }
        do {
            let features = try await client.systemFeatures()
            guard features.booksEnabled else {
                booksEnabled = false
                stats = nil
                return
            }
            booksEnabled = true
            stats = try await client.listeningStats()
        } catch {
            stats = nil
        }
    }
}
