import SwiftUI

/// Books Explore: ranked bestseller lists from pluggable sources (leslibraires
/// Palmarès, NYT). Mirrors `ExploreView`'s grid/error patterns. Covers come from
/// external CDNs as absolute URLs, so they are used directly rather than through
/// `model.absoluteURL`.
struct BookDiscoveryView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.horizontalSizeClass) private var hSizeClass

    @State private var sources: [BookDiscoverySourceDTO] = []
    @State private var source: String?
    @State private var list: String?
    @State private var items: [BookDiscoveryBook] = []
    @State private var loading = false
    @State private var error: String?
    @State private var loadGeneration = 0

    private var gridColumns: [GridItem] {
        if hSizeClass == .regular {
            return [GridItem(.adaptive(minimum: 120, maximum: 160), spacing: 12)]
        }
        return Array(repeating: GridItem(.flexible(), spacing: 12), count: 3)
    }

    private var activeSource: BookDiscoverySourceDTO? {
        sources.first { $0.id == source }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if sources.count > 1 {
                    Picker("Source", selection: sourceBinding) {
                        ForEach(sources) { s in
                            Text(s.label).tag(s.id)
                        }
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, 16)
                }

                if let activeSource, activeSource.lists.count > 1 {
                    Picker("List", selection: listBinding) {
                        ForEach(activeSource.lists) { l in
                            Text(l.label).tag(l.id)
                        }
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, 16)
                }

                content
            }
            .padding(.top, 12)
            .padding(.bottom, 32)
        }
        .background(Theme.base)
        .navigationTitle("Explore books")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await loadList() }
        .task {
            if sources.isEmpty {
                await loadSources()
            }
        }
    }

    private var sourceBinding: Binding<String> {
        Binding(
            get: { source ?? "" },
            set: { newValue in
                source = newValue
                list = sources.first { $0.id == newValue }?.lists.first?.id
                Task { await loadList() }
            }
        )
    }

    private var listBinding: Binding<String> {
        Binding(
            get: { list ?? "" },
            set: { newValue in
                list = newValue
                Task { await loadList() }
            }
        )
    }

    @ViewBuilder
    private var content: some View {
        if loading, items.isEmpty {
            skeletonGrid
        } else if items.isEmpty, let error {
            ContentUnavailableView(
                "Couldn't load this list",
                systemImage: "wifi.slash",
                description: Text(error)
            )
            .padding(.top, 16)
        } else if items.isEmpty {
            ContentUnavailableView(
                "No books to show right now",
                systemImage: "books.vertical"
            )
            .padding(.top, 28)
        } else {
            LazyVGrid(columns: gridColumns, spacing: 14) {
                ForEach(items) { book in
                    NavigationLink {
                        DiscoveryBookDetailView(book: book)
                    } label: {
                        posterCard(book)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
        }
    }

    private var skeletonGrid: some View {
        LazyVGrid(columns: gridColumns, spacing: 14) {
            ForEach(0 ..< 12, id: \.self) { _ in
                ShimmerView(cornerRadius: 10)
                    .aspectRatio(2.0 / 3.0, contentMode: .fit)
            }
        }
        .padding(.horizontal, 16)
    }

    private func posterCard(_ book: BookDiscoveryBook) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            // A fixed 2:3 tile the cover fills and is cropped to, so every card is
            // the same size regardless of the cover's own aspect ratio.
            Color.clear
                .aspectRatio(2.0 / 3.0, contentMode: .fit)
                .overlay {
                    CachedAsyncImage(
                        url: URL(string: book.coverUrl ?? ""),
                        targetSize: CGSize(width: 140, height: 210)
                    ) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        Theme.raised.overlay(
                            Image(systemName: "book.closed")
                                .font(.system(size: 22))
                                .foregroundStyle(Theme.faint)
                        )
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(alignment: .topLeading) {
                    Text("#\(book.rank)")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(.black.opacity(0.7), in: Capsule())
                        .padding(6)
                }
                .overlay(alignment: .topTrailing) {
                    if book.alreadyInLibrary {
                        Image(systemName: "checkmark")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(Color(hex: 0x10231A))
                            .frame(width: 22, height: 22)
                            .background(Theme.seed, in: Circle())
                            .accessibilityLabel("In library")
                            .padding(6)
                    }
                }
                .overlay(
                    RoundedRectangle(cornerRadius: 10).strokeBorder(.white.opacity(0.06), lineWidth: 1)
                )

            Text(book.title)
                .font(.caption)
                .foregroundStyle(Theme.textStrong)
                .lineLimit(2)
                .minimumScaleFactor(0.75)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func loadSources() async {
        guard let client = model.api() else { return }
        loading = true
        defer { loading = false }
        do {
            let fetched = try await client.bookDiscoverySources().sources
            sources = fetched
            if source == nil {
                source = fetched.first?.id
                list = fetched.first?.lists.first?.id
            }
            await loadList()
        } catch {
            self.error = settingsErrorMessage(error)
        }
    }

    private func loadList() async {
        guard let client = model.api(), let source, let list else { return }
        loadGeneration += 1
        let gen = loadGeneration
        loading = true
        error = nil
        defer {
            if gen == loadGeneration {
                loading = false
            }
        }
        do {
            let response = try await client.bookDiscovery(source: source, list: list)
            if gen == loadGeneration {
                items = response.items
            }
        } catch {
            if gen == loadGeneration {
                items = []
                self.error = settingsErrorMessage(error)
            }
        }
    }
}

/// Read-only detail for a bestseller not necessarily in the library: cover,
/// synopsis, external buy link, and an add-to-library action once enriched.
struct DiscoveryBookDetailView: View {
    @Environment(AppModel.self) private var model
    let book: BookDiscoveryBook

    @State private var adding = false
    @State private var added = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                hero
                actions
                summary
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 40)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Theme.base)
        .navigationTitle(book.title)
        .navigationBarTitleDisplayMode(.inline)
    }

    /// A blurred cover bleeds full-width behind a sharp cover and title/author —
    /// the Now Playing "dusk glow" language, so the space beside the cover is
    /// filled by the art itself rather than left as dead margin.
    private var hero: some View {
        VStack(spacing: 14) {
            CachedAsyncImage(
                url: URL(string: book.coverUrl ?? ""),
                targetSize: CGSize(width: 200, height: 300)
            ) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                Theme.raised.overlay(
                    Image(systemName: "book.closed")
                        .font(.system(size: 32))
                        .foregroundStyle(Theme.faint)
                )
            }
            .frame(width: 156, height: 234)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(.white.opacity(0.06), lineWidth: 1)
            )
            .shadow(color: .black.opacity(0.45), radius: 18, x: 0, y: 10)

            VStack(spacing: 6) {
                Text(rankLabel)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.apricot)
                Text(book.title)
                    .font(.display(24))
                    .foregroundStyle(Theme.textStrong)
                    .multilineTextAlignment(.center)
                if let author = book.author {
                    Text(author)
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                        .multilineTextAlignment(.center)
                }
                if let meta = metaLine {
                    Text(meta)
                        .font(.caption)
                        .foregroundStyle(Theme.faint)
                }
            }
        }
        .frame(maxWidth: .infinity)
    }

    private var rankLabel: String {
        // Numeric interpolation only — no user-facing words to localize.
        "#\(book.rank)"
    }

    private var metaLine: String? {
        var parts: [String] = []
        if let year = book.publishedYear {
            parts.append(String(year))
        }
        if let host = sourceHost {
            parts.append(host)
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private var sourceHost: String? {
        guard let s = book.sourceUrl, let u = URL(string: s), let h = u.host
        else { return nil }
        return h.replacingOccurrences(of: "www.", with: "")
    }

    /// Provider-agnostic external-link label — names the source's own host rather
    /// than hardcoding leslibraires (NYT points at a different domain).
    private var sourceLinkLabel: String {
        if let host = sourceHost {
            return String(localized: "View on \(host)")
        }
        return String(localized: "View source")
    }

    @ViewBuilder
    private var actions: some View {
        VStack(spacing: 12) {
            if book.alreadyInLibrary {
                Label("In library", systemImage: "checkmark.circle.fill")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.seed)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(Theme.seed.opacity(0.12), in: Capsule())
            } else if book.isbn13 != nil {
                Button {
                    Task { await add() }
                } label: {
                    HStack(spacing: 8) {
                        if adding {
                            ProgressView().tint(Theme.onAccent)
                        } else {
                            Image(systemName: added ? "checkmark" : "plus")
                        }
                        Text(added ? "Added" : "Add to library")
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.onAccent)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Theme.apricot, in: Capsule())
                }
                .disabled(adding || added)
            }

            if let sourceUrl = book.sourceUrl, let url = URL(string: sourceUrl) {
                Link(destination: url) {
                    Label(sourceLinkLabel, systemImage: "arrow.up.right")
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                }
            }
        }
    }

    @ViewBuilder
    private var summary: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Summary")
                .font(.sectionTitle)
                .foregroundStyle(Theme.textStrong)
            if let overview = book.overview, !overview.isEmpty {
                Text(overview)
                    .font(.callout)
                    .foregroundStyle(Theme.text)
                    .lineSpacing(3)
            } else {
                Text("No summary yet for this title.")
                    .font(.callout)
                    .foregroundStyle(Theme.faint)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func add() async {
        guard let client = model.api() else { return }
        adding = true
        defer { adding = false }
        do {
            try await client.addDiscoveryBook(book)
            added = true
            model.toast(String(localized: "Added to library."), style: .success)
        } catch {
            model.toast(settingsErrorMessage(error), style: .error)
        }
    }
}
