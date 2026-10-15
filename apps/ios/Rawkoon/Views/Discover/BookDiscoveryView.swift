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
    /// The source/list the grid's items belong to, so a switch never shows another list's books.
    @State private var itemsKey: String?

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
            .rawkoonMotion(RawkoonMotion.spring, value: loading)
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
        .onChange(of: model.isOffline) { _, offline in
            guard !offline, error != nil else { return }
            Task {
                if sources.isEmpty {
                    await loadSources()
                } else {
                    await loadList()
                }
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
                .transition(.rawkoonSwap)
        } else if items.isEmpty, error != nil, model.isOffline {
            ContentUnavailableView(
                "You're offline",
                systemImage: "wifi.slash",
                description: Text("This will load when you're back online.")
            )
            .rawkoonLivingSymbol(.error)
            .padding(.top, 16)
            .transition(.rawkoonSwap)
        } else if items.isEmpty, let error {
            ContentUnavailableView(
                "Couldn't load this list",
                systemImage: "wifi.slash",
                description: Text(error)
            )
            .rawkoonLivingSymbol(.error)
            .padding(.top, 16)
            .transition(.rawkoonSwap)
        } else if items.isEmpty {
            ContentUnavailableView(
                "No books to show right now",
                systemImage: "books.vertical"
            )
            .rawkoonLivingSymbol(.empty)
            .padding(.top, 28)
            .transition(.rawkoonSwap)
        } else {
            LazyVGrid(columns: gridColumns, spacing: 14) {
                ForEach(items) { book in
                    NavigationLink {
                        DiscoveryBookDetailView(book: book)
                    } label: {
                        posterCard(book)
                    }
                    .buttonStyle(.rawkoonPressable)
                    .rawkoonEntrance(id: book.id)
                }
            }
            .padding(.horizontal, 16)
            .rawkoonEntranceScope()
            .transition(.rawkoonSwap)
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
        if sources.isEmpty, let cached = client.cached(Endpoints.bookDiscoverySources) {
            applySources(cached.value.sources)
            paintListFromCache(client: client)
        }
        loading = true
        defer { loading = false }
        do {
            let fetched = try await client.bookDiscoverySources().sources
            applySources(fetched)
            await loadList()
        } catch {
            if sources.isEmpty {
                self.error = settingsErrorMessage(error)
            } else {
                await loadList()
            }
        }
    }

    private func applySources(_ fetched: [BookDiscoverySourceDTO]) {
        sources = fetched
        if source == nil {
            source = fetched.first?.id
            list = fetched.first?.lists.first?.id
        }
    }

    /// Swaps in the saved copy of the selected list when the grid holds another list (or none).
    private func paintListFromCache(client: APIClient) {
        guard let source, let list else { return }
        let key = "\(source)/\(list)"
        guard itemsKey != key else { return }
        items = client.cached(Endpoints.bookDiscovery(source: source, list: list))?.value.items ?? []
        itemsKey = key
    }

    private func loadList() async {
        guard let client = model.api(), let source, let list else { return }
        paintListFromCache(client: client)
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
            // The grid already holds this list's saved books (or none); keep them.
            if gen == loadGeneration {
                self.error = settingsErrorMessage(error)
            }
        }
    }
}
