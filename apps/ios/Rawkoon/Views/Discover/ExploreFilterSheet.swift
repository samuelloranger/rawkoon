import SwiftUI

/// Filter sheet for `ExploreView`: type, streaming provider, genre, sort, and
/// an original-language toggle. Genres and providers are TMDB lists that
/// differ by `kind`, so this sheet fetches its own copies and refetches when
/// the type segment changes — the caller only owns `filters`.
struct ExploreFilterSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @Binding var filters: ExploreFilters

    @State private var genres: [Genre] = []
    @State private var providers: [StreamingProvider] = []
    @State private var loadingOptions = false
    @State private var optionsError: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    typeSection
                    if let optionsError {
                        Text(optionsError)
                            .font(.footnote)
                            .foregroundStyle(Theme.terracotta)
                    }
                    providerSection
                    genreSection
                    sortSection
                    languageSection
                }
                .padding(16)
            }
            .background(Theme.base)
            .navigationTitle("Filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Reset") { filters = ExploreFilters(kind: filters.kind) }
                        .disabled(filters.isDefault)
                }
            }
        }
        .task {
            if genres.isEmpty, providers.isEmpty {
                await loadOptions()
            }
        }
        .onChange(of: filters.kind) { _, _ in
            filters.provider = nil
            filters.genre = nil
            Task { await loadOptions() }
        }
    }

    // MARK: Sections

    private var typeSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionTitle("Type")
            Picker("Type", selection: $filters.kind) {
                ForEach(ExploreFilters.Kind.allCases) { kind in
                    Text(kind.label).tag(kind)
                }
            }
            .pickerStyle(.segmented)
        }
    }

    @ViewBuilder
    private var providerSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionTitle("Streaming provider")
            if loadingOptions, providers.isEmpty {
                LazyVGrid(columns: optionColumns, spacing: 12) {
                    ForEach(0 ..< 6, id: \.self) { _ in
                        ShimmerView(cornerRadius: 12).frame(height: 72)
                    }
                }
            } else if providers.isEmpty {
                Text("No providers available in this region.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            } else {
                LazyVGrid(columns: optionColumns, spacing: 12) {
                    ForEach(providers) { provider in
                        providerTile(provider)
                    }
                }
            }
        }
    }

    private var optionColumns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: 12), count: 3)
    }

    private func providerTile(_ provider: StreamingProvider) -> some View {
        let selected = filters.provider == provider
        return Button {
            filters.provider = selected ? nil : provider
        } label: {
            VStack(spacing: 6) {
                AsyncImage(url: provider.logoUrl.flatMap(URL.init(string:))) { image in
                    image.resizable().scaledToFit()
                } placeholder: {
                    Theme.raised
                }
                .frame(width: 40, height: 40)
                .clipShape(RoundedRectangle(cornerRadius: 8))

                Text(provider.name)
                    .font(.caption2)
                    .foregroundStyle(selected ? Theme.textStrong : Theme.muted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity, minHeight: 44)
            .padding(8)
            .background(
                selected ? Theme.raised : Theme.inset,
                in: RoundedRectangle(cornerRadius: 12)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(selected ? Theme.apricot : Theme.border, lineWidth: selected ? 2 : 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }

    @ViewBuilder
    private var genreSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionTitle("Genre")
            if loadingOptions, genres.isEmpty {
                ShimmerView(cornerRadius: 12).frame(height: 72)
            } else if genres.isEmpty {
                Text("No genres available.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: 8)], alignment: .leading, spacing: 8) {
                    ForEach(genres) { genre in
                        genreChip(genre)
                    }
                }
            }
        }
    }

    private func genreChip(_ genre: Genre) -> some View {
        let selected = filters.genre == genre
        return Button {
            filters.genre = selected ? nil : genre
        } label: {
            Text(genre.name)
                .font(.subheadline.weight(selected ? .semibold : .regular))
                .foregroundStyle(selected ? Theme.onAccent : Theme.text)
                .lineLimit(1)
                .padding(.horizontal, 12)
                .frame(minHeight: 44)
                .background(selected ? Theme.apricot : Theme.inset, in: Capsule())
                .overlay(Capsule().strokeBorder(selected ? .clear : Theme.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }

    private var sortSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionTitle("Sort")
            Menu {
                ForEach(DiscoverSort.allCases, id: \.self) { sort in
                    Button {
                        filters.sort = sort
                    } label: {
                        if filters.sort == sort {
                            Label(sort.label, systemImage: "checkmark")
                        } else {
                            Text(sort.label)
                        }
                    }
                }
            } label: {
                HStack {
                    Text(filters.sort.label)
                        .foregroundStyle(Theme.textStrong)
                    Spacer()
                    Image(systemName: "chevron.up.chevron.down")
                        .foregroundStyle(Theme.muted)
                }
                .padding(.horizontal, 12)
                .frame(minHeight: 44)
                .background(Theme.inset, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.border, lineWidth: 1))
            }
        }
    }

    private var languageSection: some View {
        Toggle(isOn: $filters.originalLanguageOnly) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Original language")
                Text("Only show titles originally in \(Locale.current.localizedLanguageName)")
                    .font(.caption)
                    .foregroundStyle(Theme.muted)
            }
        }
        .tint(Theme.apricot)
        .padding(.horizontal, 12)
        .frame(minHeight: 44)
        .background(Theme.inset, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.border, lineWidth: 1))
    }

    private func sectionTitle(_ key: LocalizedStringKey) -> some View {
        Text(key)
            .font(.display(15))
            .foregroundStyle(Theme.textStrong)
    }

    // MARK: Data

    private func loadOptions() async {
        loadingOptions = true
        optionsError = nil
        defer { loadingOptions = false }

        guard let client = model.api() else {
            optionsError = String(localized: "Not signed in.")
            return
        }
        do {
            async let genresTask = client.genres(type: filters.kind.apiValue)
            async let providersTask = client.streamingProviders(type: filters.kind.apiValue)
            genres = try await genresTask
            providers = try await providersTask
        } catch {
            optionsError = String(localized: "Could not load filter options.")
        }
    }
}

extension DiscoverSort {
    /// Human labels for the sort menu — mirrors `DISCOVER_VALID_SORTS` ordering.
    var label: LocalizedStringKey {
        switch self {
        case .popularityDesc: "Most popular"
        case .popularityAsc: "Least popular"
        case .voteAverageDesc: "Highest rated"
        case .voteAverageAsc: "Lowest rated"
        case .primaryReleaseDateDesc: "Newest releases"
        case .firstAirDateDesc: "Newest first-aired"
        case .revenueDesc: "Highest revenue"
        }
    }
}

private extension Locale {
    /// Best-effort display name for the device's current language, used only
    /// in the toggle's caption copy.
    var localizedLanguageName: String {
        guard let code = language.languageCode?.identifier else { return "your language" }
        return localizedString(forLanguageCode: code) ?? code
    }
}
