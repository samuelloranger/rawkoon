import RawkoonKit
import SwiftUI

/// One shelf: its name and description, then its titles in display order, one
/// section per group header and numbered when the order is by hand. A title the
/// library has opens its page; one it lacks opens the page where it can be
/// requested. Administrators get the editor from the toolbar.
struct ShelfDetailView: View {
    @Environment(AppModel.self) private var model
    let shelfId: Int

    @State private var detail: ShelfDetail?
    @State private var loading = true
    @State private var error: String?
    @State private var editing = false

    private let columns = [GridItem(.adaptive(minimum: 104), spacing: 12)]

    var body: some View {
        ScrollView {
            content
                .padding(.top, 12)
                .padding(.bottom, 32)
        }
        .reportsTabBarScroll()
        .refreshable { await load() }
        .background(Theme.base)
        .navigationTitle(detail?.name ?? String(localized: "Shelf"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if model.isAdmin, detail != nil {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        editing = true
                    } label: {
                        Label("Edit shelf", systemImage: "pencil")
                    }
                    .requiresConnection(model.isOffline)
                }
            }
        }
        .sheet(isPresented: $editing) {
            if let detail {
                ShelfEditorView(detail: detail) { updated in
                    self.detail = updated
                }
                .environment(model)
            }
        }
        .task { await load() }
        .onChange(of: model.isOffline) { _, offline in
            guard !offline, detail == nil else { return }
            Task { await load() }
        }
    }

    @ViewBuilder private var content: some View {
        if let detail {
            VStack(alignment: .leading, spacing: 18) {
                header(detail)
                if detail.entries.isEmpty {
                    ContentUnavailableView(
                        "Nothing here yet",
                        systemImage: "square.stack",
                        description: Text(
                            model.isAdmin
                                ? "Add titles from the editor."
                                : "This shelf has no titles."
                        )
                    )
                    .rawkoonLivingSymbol(.empty)
                    .padding(.top, 24)
                } else {
                    groups(detail)
                }
            }
            .padding(.horizontal, 16)
        } else if loading {
            VStack(spacing: 12) {
                ForEach(0 ..< 3, id: \.self) { _ in
                    ShimmerView(cornerRadius: 14).frame(height: 120)
                }
            }
            .padding(.horizontal, 16)
            .allowsHitTesting(false)
        } else {
            ContentUnavailableView(
                "Couldn't load this shelf",
                systemImage: "wifi.slash",
                description: Text(error ?? "")
            )
            .rawkoonLivingSymbol(.error)
            .padding(.top, 24)
        }
    }

    private func header(_ detail: ShelfDetail) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(verbatim: detail.name)
                .font(.display(24))
                .foregroundStyle(Theme.textStrong)
            if let description = detail.description, !description.isEmpty {
                Text(verbatim: description)
                    .font(.subheadline)
                    .foregroundStyle(Theme.text)
            }
            Text("\(detail.entryCount) titles")
                .font(.caption)
                .foregroundStyle(Theme.muted)
        }
    }

    /// One section per header, in the order the headers first appear.
    @ViewBuilder private func groups(_ detail: ShelfDetail) -> some View {
        let numbered = detail.orderMode == .manual
        let numbers = Dictionary(uniqueKeysWithValues: detail.entries.enumerated().map { ($0.element.id, $0.offset + 1) })
        let grouped = ShelfGrouping.groups(detail.entries)
        VStack(alignment: .leading, spacing: 20) {
            ForEach(Array(grouped.enumerated()), id: \.offset) { _, group in
                VStack(alignment: .leading, spacing: 10) {
                    if let label = group.label {
                        Text(verbatim: label)
                            .font(.display(16))
                            .foregroundStyle(Theme.textStrong)
                    }
                    LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
                        ForEach(Array(group.entries.enumerated()), id: \.element.id) { _, entry in
                            card(entry, number: numbered ? numbers[entry.id] : nil)
                                .rawkoonEntrance(id: entry.id)
                        }
                    }
                }
            }
        }
        .rawkoonEntranceScope()
    }

    private func card(_ entry: ShelfEntry, number: Int?) -> some View {
        NavigationLink {
            MediaDetailView(
                tmdbId: entry.tmdbId,
                mediaType: entry.isMovie ? "movie" : "tv",
                title: entry.title,
                posterPath: entry.posterUrl,
                libraryId: entry.libraryId
            )
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                CachedAsyncImage(url: model.absoluteURL(entry.posterUrl), targetSize: CGSize(width: 208, height: 312)) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Theme.inset
                }
                .aspectRatio(2.0 / 3.0, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(alignment: .bottomLeading) {
                    if !entry.inLibrary {
                        Text("Request")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(Theme.textStrong)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(.black.opacity(0.75), in: RoundedRectangle(cornerRadius: 4))
                            .padding(5)
                    }
                }
                .opacity(entry.inLibrary ? 1 : 0.55)
                Text(verbatim: number.map { "\($0). \(entry.title)" } ?? entry.title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.textStrong)
                    .lineLimit(2)
                Text(verbatim: subtitle(entry))
                    .font(.caption2)
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
            }
        }
        .buttonStyle(.rawkoonPressable)
        .accessibilityLabel(Text(verbatim: "\(entry.title), \(entry.inLibrary ? String(localized: "in library") : String(localized: "not in library"))"))
    }

    private func subtitle(_ entry: ShelfEntry) -> String {
        var parts: [String] = []
        if let season = entry.season {
            parts.append(String(localized: "Season \(season)"))
        }
        if let year = entry.year {
            parts.append(String(year))
        }
        parts.append(entry.inLibrary ? String(localized: "In library") : String(localized: "Not in library"))
        return parts.joined(separator: " · ")
    }

    private func load() async {
        guard let client = model.api() else {
            error = String(localized: "Not signed in.")
            loading = false
            return
        }
        do {
            detail = try await client.shelf(id: shelfId)
            error = nil
        } catch is CancellationError {
            return
        } catch let apiError as APIError {
            error = apiError.userMessage(unauthorized: String(localized: "Sign in required."))
        } catch {
            self.error = String(localized: "Can't reach the server. Try again in a moment.")
        }
        loading = false
    }
}

/// The groups a shelf's titles read in: one per header, in the order the headers
/// first appear, with the ungrouped ones first under no name.
enum ShelfGrouping {
    struct Group {
        let label: String?
        let entries: [ShelfEntry]
    }

    static func groups(_ entries: [ShelfEntry]) -> [Group] {
        var order: [String?] = []
        var grouped: [String?: [ShelfEntry]] = [:]
        for entry in entries {
            if grouped[entry.groupLabel] == nil {
                order.append(entry.groupLabel)
                grouped[entry.groupLabel] = []
            }
            grouped[entry.groupLabel]?.append(entry)
        }
        return order.map { Group(label: $0, entries: grouped[$0] ?? []) }
    }
}
