import SwiftUI

/// A horizontally scrolling strip of at-a-glance facts (rating, runtime, year,
/// status, genres, external ratings). Warm shimmer placeholders stand in while
/// the modal details are still loading. All data, never the lamp.
struct DetailFactsStrip: View {
    let details: TmdbMediaDetails?
    let ratings: MediaRatings?
    let mediaType: String
    let loading: Bool

    private struct Fact: Identifiable {
        let id: String
        let label: LocalizedStringKey
        let value: String
    }

    var body: some View {
        Group {
            if loading, details == nil {
                ShimmerView(cornerRadius: 14)
                    .frame(height: 180)
            } else if !facts.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    Text("At a glance")
                        .font(.sectionTitle)
                        .foregroundStyle(Theme.textStrong)
                    factGrid
                }
            }
        }
        .padding(.horizontal, 16)
    }

    /// Two-column grid of label/value cells with hairline dividers between rows
    /// and columns — the "At a glance" card that replaced the horizontal strip.
    private var factGrid: some View {
        let rows = stride(from: 0, to: facts.count, by: 2).map { start in
            Array(facts[start ..< min(start + 2, facts.count)])
        }
        return VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.offset) { index, pair in
                HStack(spacing: 0) {
                    cell(pair[0])
                    Divider().overlay(Theme.border)
                    if pair.count > 1 {
                        cell(pair[1])
                    } else {
                        Color.clear.frame(maxWidth: .infinity)
                    }
                }
                if index < rows.count - 1 {
                    Divider().overlay(Theme.border)
                }
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1))
    }

    private func cell(_ fact: Fact) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(fact.label)
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Theme.faint)
                .textCase(.uppercase)
            Text(verbatim: fact.value)
                .font(.system(.subheadline, design: .monospaced).weight(.medium))
                .foregroundStyle(Theme.textStrong)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
    }

    private var facts: [Fact] {
        var list: [Fact] = []
        if let vote = details?.voteAverage, vote > 0 {
            list.append(Fact(id: "tmdb", label: "TMDB", value: String(format: "%.1f", vote)))
        }
        if let imdb = ratings?.imdbRating, !imdb.isEmpty {
            list.append(Fact(id: "imdb", label: "IMDb", value: imdb))
        }
        if let rt = ratings?.rottenTomatoes, !rt.isEmpty {
            list.append(Fact(id: "rt", label: "Rotten Tomatoes", value: rt))
        }
        if let meta = ratings?.metacritic, !meta.isEmpty {
            list.append(Fact(id: "metacritic", label: "Metacritic", value: meta))
        }
        if let year = yearValue {
            list.append(Fact(id: "year", label: "Year", value: String(year)))
        }
        if mediaType == "tv" {
            if let seasons = details?.numberOfSeasons, seasons > 0 {
                list.append(Fact(id: "seasons", label: "Seasons", value: String(seasons)))
            }
        } else if let runtime = details?.runtime, runtime > 0 {
            let hours = runtime / 60
            let minutes = runtime % 60
            list.append(Fact(id: "runtime", label: "Runtime", value: hours > 0 ? "\(hours)h \(minutes)m" : "\(minutes)m"))
        }
        if let status = details?.status, !status.isEmpty {
            list.append(Fact(id: "status", label: "Status", value: status.capitalized))
        }
        if let genres = details?.genres, !genres.isEmpty {
            list.append(Fact(id: "genres", label: "Genres", value: genres.map(\.name).joined(separator: ", ")))
        }
        return list
    }

    private var yearValue: Int? {
        let raw = mediaType == "tv" ? details?.firstAirDate : details?.releaseDate
        guard let raw, raw.count >= 4 else { return nil }
        return Int(raw.prefix(4))
    }
}
