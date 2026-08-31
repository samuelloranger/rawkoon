import SwiftUI

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

    @State private var details: TmdbMediaDetails?
    @State private var loading = false
    @State private var errorMessage: String?

    @State private var requesting = false
    @State private var requested = false
    @State private var added = false
    @State private var requestError: String?

    @State private var showingReleaseSearch = false

    @State private var episodesBySeason: [Int: [Episode]] = [:]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if loading && details == nil {
                    ProgressView().tint(Theme.apricot)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 16)
                } else if let errorMessage, details == nil {
                    ContentUnavailableView(
                        "Couldn't load details",
                        systemImage: "exclamationmark.triangle",
                        description: Text(errorMessage)
                    )
                    .padding(.top, 28)
                } else {
                    hero
                    statusRow
                    if let overview = details?.overview, !overview.isEmpty {
                        Text(overview)
                            .font(.subheadline)
                            .foregroundStyle(Theme.muted)
                    }
                    primaryAction
                    if mediaType == "tv" {
                        seasonsSection
                    } else {
                        detailsSection
                    }
                }
            }
            .padding(.bottom, 24)
        }
        .background(Theme.base)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if details == nil {
                await fetchDetails()
            }
        }
        .sheet(isPresented: $showingReleaseSearch) {
            ReleaseSearchView(query: title, libraryMediaId: libraryId, tmdbId: tmdbId, mediaType: mediaType)
                .environmentObject(model)
        }
    }

    // MARK: Hero

    private var hero: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .bottomLeading) {
                AsyncImage(url: model.absoluteURL(details?.primaryBackdropUrl)) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Theme.raised
                }
                .frame(height: 200)
                .clipped()

                LinearGradient(
                    colors: [.clear, Theme.base],
                    startPoint: .top, endPoint: .bottom
                )
                .frame(height: 200)

                HStack(alignment: .bottom, spacing: 14) {
                    posterThumb
                    VStack(alignment: .leading, spacing: 6) {
                        Text(title)
                            .font(.display(22))
                            .foregroundStyle(Theme.textStrong)
                            .lineLimit(3)
                        Text(metaLine)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(Theme.faint)
                        if let tagline = details?.tagline, !tagline.isEmpty {
                            Text(tagline)
                                .font(.caption.italic())
                                .foregroundStyle(Theme.muted)
                                .lineLimit(2)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 12)
            }
            .frame(height: 200)
        }
    }

    private var posterThumb: some View {
        RoundedRectangle(cornerRadius: 10)
            .fill(Theme.raised)
            .frame(width: 84, height: 126)
            .overlay(
                AsyncImage(url: model.absoluteURL(posterPath)) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    LinearGradient(
                        colors: [Theme.terracottaDeep, Theme.apricot],
                        startPoint: .topLeading, endPoint: .bottomTrailing
                    )
                }
                .frame(width: 84, height: 126)
                .clipped()
            )
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(.white.opacity(0.08), lineWidth: 1))
            .shadow(color: .black.opacity(0.5), radius: 10, y: 6)
    }

    private var metaLine: String {
        var parts: [String] = []
        if let year = yearValue {
            parts.append(String(year))
        }
        if mediaType == "tv" {
            parts.append("\(details?.numberOfSeasons ?? 0) seasons")
        } else if let runtime = details?.runtime, runtime > 0 {
            let hours = runtime / 60
            let minutes = runtime % 60
            parts.append(hours > 0 ? "\(hours)h \(minutes)m" : "\(minutes)m")
        }
        if let genres = details?.genres, !genres.isEmpty {
            parts.append(genres.map(\.name).joined(separator: ", "))
        }
        return parts.joined(separator: " · ")
    }

    private var yearValue: Int? {
        let raw = mediaType == "tv" ? details?.firstAirDate : details?.releaseDate
        guard let raw, raw.count >= 4 else { return nil }
        return Int(raw.prefix(4))
    }

    // MARK: Status + primary action

    private var statusRow: some View {
        HStack {
            if libraryId != nil || added {
                StatusBadge(text: "In library", tint: Theme.seed)
            } else if requested {
                StatusBadge(text: "Requested", tint: Theme.seed)
            } else {
                StatusBadge(text: "Not added", tint: Theme.muted)
            }
            Spacer()
        }
        .padding(.horizontal, 16)
    }

    @ViewBuilder
    private var primaryAction: some View {
        VStack(alignment: .leading, spacing: 8) {
            if libraryId == nil {
                if !requested && !added {
                    Button {
                        Task { model.isAdmin ? await submitAdd() : await submitRequest() }
                    } label: {
                        Group {
                            if requesting {
                                ProgressView().tint(Theme.onAccent)
                            } else {
                                // Admins add straight to the library; everyone else requests.
                                Label(model.isAdmin ? "Add to library" : "Request",
                                      systemImage: model.isAdmin ? "plus.circle.fill" : "plus.circle")
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 26)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.apricot)
                    .foregroundStyle(Theme.onAccent)
                    .fontWeight(.semibold)
                    .disabled(requesting)
                }
                if let requestError {
                    Text(requestError)
                        .font(.caption)
                        .foregroundStyle(Theme.terracotta)
                }
            } else {
                Button {
                    showingReleaseSearch = true
                } label: {
                    Label("Search releases", systemImage: "magnifyingglass")
                        .frame(maxWidth: .infinity).frame(height: 22)
                }
                .buttonStyle(.bordered)
                .tint(Theme.apricot)
            }
        }
        .padding(.horizontal, 16)
    }

    // MARK: Details (movies)

    @ViewBuilder
    private var detailsSection: some View {
        if hasDetailsToShow {
            VStack(alignment: .leading, spacing: 10) {
                Text("Details")
                    .font(.display(17))
                    .foregroundStyle(Theme.textStrong)

                VStack(spacing: 0) {
                    if let voteAverage = details?.voteAverage, voteAverage > 0 {
                        detailRow(label: "Rating", value: String(format: "%.1f/10", voteAverage))
                    }
                    if let status = details?.status, !status.isEmpty {
                        detailRow(label: "Status", value: status)
                    }
                    if let runtime = details?.runtime, runtime > 0 {
                        let hours = runtime / 60
                        let minutes = runtime % 60
                        let runtimeText = hours > 0 ? "\(hours)h \(minutes)m" : "\(minutes)m"
                        detailRow(label: "Runtime", value: runtimeText)
                    }
                }
                .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.border, lineWidth: 1))
            }
            .padding(.horizontal, 16)
        }
    }

    private var hasDetailsToShow: Bool {
        (details?.voteAverage ?? 0) > 0
            || !(details?.status ?? "").isEmpty
            || (details?.runtime ?? 0) > 0
    }

    private func detailRow(label: String, value: String) -> some View {
        HStack {
            Text(label.uppercased())
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Theme.faint)
            Spacer()
            Text(value)
                .font(.system(.subheadline, design: .monospaced))
                .foregroundStyle(Theme.text)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .overlay(alignment: .bottom) {
            Divider().overlay(Theme.border)
        }
    }

    // MARK: Seasons

    @ViewBuilder
    private var seasonsSection: some View {
        if let seasons = details?.seasons, !seasons.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text("Seasons")
                    .font(.display(17))
                    .foregroundStyle(Theme.textStrong)

                VStack(spacing: 8) {
                    ForEach(seasons.sorted(by: { $0.seasonNumber < $1.seasonNumber }), id: \.seasonNumber) { season in
                        if season.seasonNumber != 0 || season.episodeCount > 0 {
                            seasonRow(season)
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
        }
    }

    private func seasonRow(_ season: SeasonSummary) -> some View {
        let episodes = episodesBySeason[season.seasonNumber]
        let downloaded = episodes?.filter { $0.status == "downloaded" }.count
        let total = episodes?.count ?? season.episodeCount

        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(season.name)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.textStrong)
                Spacer()
                if libraryId != nil {
                    Text("\(downloaded ?? 0)/\(total)")
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(Theme.muted)
                } else {
                    Text("\(season.episodeCount) episodes")
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(Theme.muted)
                }
            }
            if libraryId != nil, total > 0 {
                DuskProgress(value: Double(downloaded ?? 0) / Double(total))
            }
        }
        .padding(12)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.border, lineWidth: 1))
    }

    // MARK: Networking

    private func fetchDetails() async {
        guard let client = model.api() else {
            errorMessage = "Not logged in."
            return
        }
        loading = true
        errorMessage = nil
        defer { loading = false }

        do {
            let response = try await client.mediaModal(mediaType: mediaType, tmdbId: tmdbId)
            details = response.details

            if mediaType == "tv", let libraryId {
                await fetchEpisodes(client: client, libraryId: libraryId)
            }
        } catch APIError.unauthorized {
            errorMessage = "Admin only."
        } catch {
            errorMessage = "Could not load details."
        }
    }

    private func fetchEpisodes(client: APIClient, libraryId: Int) async {
        do {
            let response = try await client.libraryEpisodes(id: libraryId)
            var map: [Int: [Episode]] = [:]
            for season in response.seasons {
                map[season.season] = season.episodes
            }
            episodesBySeason = map
        } catch {
            // Non-fatal: seasons still render with episode counts from TMDB.
        }
    }

    private func submitRequest() async {
        guard let client = model.api() else {
            requestError = "Not logged in."
            return
        }
        requesting = true
        requestError = nil
        defer { requesting = false }

        let body = CreateRequestBody(
            tmdbId: tmdbId,
            type: mediaType == "tv" ? "show" : "movie",
            title: title,
            posterUrl: posterPath,
            year: yearValue
        )

        do {
            _ = try await client.createRequest(body)
            requested = true
        } catch APIError.unauthorized {
            requestError = "Admin only."
        } catch APIError.http(let status) where status == 409 {
            requestError = "Already requested."
        } catch {
            requestError = "Could not submit request."
        }
    }

    // Admin: add straight to the library from TMDB.
    private func submitAdd() async {
        guard let client = model.api() else {
            requestError = "Not logged in."
            return
        }
        requesting = true
        requestError = nil
        defer { requesting = false }
        do {
            try await client.addToLibrary(tmdbId: tmdbId, type: mediaType == "tv" ? "show" : "movie")
            added = true
        } catch APIError.unauthorized {
            requestError = "Admin only."
        } catch APIError.http(let status) where status == 409 {
            added = true
        } catch {
            requestError = "Could not add to library."
        }
    }
}
