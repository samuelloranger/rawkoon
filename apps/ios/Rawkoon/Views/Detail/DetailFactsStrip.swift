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
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                if loading, details == nil {
                    ForEach(0 ..< 4, id: \.self) { _ in
                        ShimmerView(cornerRadius: 10)
                            .frame(width: 70, height: 46)
                    }
                } else {
                    ForEach(facts) { fact in
                        pill(fact)
                    }
                }
            }
            .padding(.horizontal, 16)
        }
    }

    private func pill(_ fact: Fact) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(fact.label)
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Theme.faint)
                .textCase(.uppercase)
            Text(verbatim: fact.value)
                .font(.system(.subheadline, design: .monospaced).weight(.medium))
                .foregroundStyle(Theme.textStrong)
                .lineLimit(1)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(minHeight: 46)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.border, lineWidth: 1))
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
