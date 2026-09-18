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
            CachedAsyncImage(
                url: URL(string: book.coverUrl ?? ""),
                targetSize: CGSize(width: 140, height: 210)
            ) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                Theme.raised
            }
            .aspectRatio(2.0 / 3.0, contentMode: .fit)
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
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top, spacing: 16) {
                    CachedAsyncImage(
                        url: URL(string: book.coverUrl ?? ""),
                        targetSize: CGSize(width: 140, height: 210)
                    ) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        Theme.raised
                    }
                    .frame(width: 120, height: 180)
                    .clipShape(RoundedRectangle(cornerRadius: 10))

                    VStack(alignment: .leading, spacing: 6) {
                        if let author = book.author {
                            Text(author).foregroundStyle(Theme.muted)
                        }
                        if let year = book.publishedYear {
                            Text(String(year)).font(.caption).foregroundStyle(Theme.muted)
                        }
                        Text("#\(book.rank)").font(.caption).foregroundStyle(Theme.muted)
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 16)

                if let overview = book.overview, !overview.isEmpty {
                    Text(overview)
                        .font(.callout)
                        .foregroundStyle(Theme.textStrong)
                        .padding(.horizontal, 16)
                }

                actions
                    .padding(.horizontal, 16)
            }
            .padding(.vertical, 16)
        }
        .background(Theme.base)
        .navigationTitle(book.title)
        .navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder
    private var actions: some View {
        VStack(alignment: .leading, spacing: 10) {
            if book.alreadyInLibrary {
                Label("In library", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(Theme.seed)
            } else if let volumeId = book.volumeId {
                Button {
                    Task { await add(volumeId: volumeId) }
                } label: {
                    if adding {
                        ProgressView().tint(.white)
                    } else {
                        Label(added ? "Added" : "Add to library", systemImage: "plus")
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.apricot)
                .disabled(adding || added)
            }

            if let sourceUrl = book.sourceUrl, let url = URL(string: sourceUrl) {
                Link(destination: url) {
                    Label("View source", systemImage: "arrow.up.right.square")
                }
                .foregroundStyle(Theme.muted)
            }
        }
    }

    private func add(volumeId: String) async {
        guard let client = model.api() else { return }
        adding = true
        defer { adding = false }
        do {
            try await client.addBook(googleVolumeId: volumeId)
            added = true
            model.toast(String(localized: "Added to library."), style: .success)
        } catch {
            model.toast(settingsErrorMessage(error), style: .error)
        }
    }
}
