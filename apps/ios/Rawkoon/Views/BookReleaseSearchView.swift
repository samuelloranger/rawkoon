import SwiftUI

/// Add an audiobook (or ebook) edition to a book, then search indexers and grab
/// a release — mirrors the web book-detail flow. Presented as a sheet.
struct BookReleaseSearchView: View {
    @Environment(AppModel.self) private var model

    let bookId: Int
    let kind: String // "audiobook" | "ebook"
    let title: String

    @State private var releases: [BookRelease] = []
    @State private var loading = true
    @State private var errorMessage: String?
    @State private var grabError: String?
    @State private var grabbing: String?
    @State private var grabbed: Set<String> = []
    @State private var showRejected = false

    var body: some View {
        VStack(spacing: 0) {
            ReleaseSheetHeader(
                title: kind == "audiobook" ? "Add audiobook" : "Add ebook",
                subtitle: title
            )

            // One slot, so the outgoing state never stacks above the incoming one.
            ZStack(alignment: .top) {
                content
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Theme.base)
        .presentationDetents([.large])
        .rawkoonMotion(RawkoonMotion.spring, value: phase)
        .rawkoonMotion(RawkoonMotion.spring, value: grabError)
        // One success tap per confirmed grab.
        .sensoryFeedback(RawkoonHaptics.feedback(for: .grab), trigger: grabbed.count)
        .task { await start() }
        .onChange(of: model.isOffline) { _, offline in
            guard !offline, releases.isEmpty, !loading else { return }
            Task { await start() }
        }
    }

    @ViewBuilder
    private var content: some View {
        if loading {
            ReleaseSheetStateView(kind: .searching)
        } else if model.isOffline, releases.isEmpty {
            ReleaseSheetStateView(kind: .offline)
        } else if let errorMessage, releases.isEmpty {
            ReleaseSheetStateView(kind: .failed(errorMessage))
        } else if visibleReleases.isEmpty {
            ReleaseSheetStateView(kind: .empty(String(localized: "Nothing grabbable found for this book.")))
        } else {
            VStack(alignment: .leading, spacing: 0) {
                if let grabError {
                    Text(grabError)
                        .font(.subheadline)
                        .foregroundStyle(Theme.terracotta)
                        .padding(.horizontal, 16)
                        .padding(.bottom, 8)
                        .transition(.rawkoonReveal)
                }
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(visibleReleases) { release in
                            releaseRow(release)
                                .rawkoonEntrance(id: release.guid)
                        }
                        if hasRejected {
                            ReleaseRejectedToggle(isShown: $showRejected)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 24)
                    .rawkoonEntranceScope()
                }
            }
            .transition(.rawkoonSwap)
        }
    }

    /// Mirrors `content`'s branch order, so every swap between states animates.
    private enum Phase: Equatable {
        case searching, offline, failed, empty, list
    }

    private var phase: Phase {
        if loading {
            return .searching
        }
        if model.isOffline, releases.isEmpty {
            return .offline
        }
        if errorMessage != nil, releases.isEmpty {
            return .failed
        }
        return visibleReleases.isEmpty ? .empty : .list
    }

    private var visibleReleases: [BookRelease] {
        showRejected ? releases : releases.filter { $0.rejected != true }
    }

    private var hasRejected: Bool {
        releases.contains { $0.rejected == true }
    }

    private func releaseRow(_ release: BookRelease) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(release.title)
                .font(.subheadline)
                .foregroundStyle(release.rejected == true ? Theme.muted : Theme.text)
                .lineLimit(2)
            HStack(spacing: 8) {
                if let format = release.format {
                    BadgeChip(text: format.uppercased(), fg: Theme.apricotSoft, bg: Theme.apricot.opacity(0.12))
                }
                Text(sizeText(release.sizeBytes)).font(.system(.caption2, design: .monospaced)).foregroundStyle(Theme.muted)
                Label("\(release.seeders ?? 0)", systemImage: "arrow.up")
                    .font(.system(.caption2, design: .monospaced)).foregroundStyle(Theme.seed)
                Spacer(minLength: 4)
                // One slot, so the button, spinner and "Grabbed" crossfade in place.
                ZStack(alignment: .trailing) {
                    grabButton(release)
                }
                .rawkoonMotion(RawkoonMotion.snappy, value: [grabbing == release.guid, grabbed.contains(release.guid)])
            }
            if let indexer = release.indexer {
                Text("\(indexer) · \(release.age ?? 0)d")
                    .font(.system(.caption2, design: .monospaced)).foregroundStyle(Theme.faint)
            }
            if release.rejected == true, let reason = release.rejections?.first {
                Text(reason).font(.caption2).foregroundStyle(Theme.terracotta).lineLimit(1)
            }
        }
        .releaseCard()
        // `grabbed` gains a guid only after the grab call succeeds; the sheet plays the haptic.
        .rawkoonCelebrate(
            trigger: grabbed.contains(release.guid),
            ring: .roundedRect(cornerRadius: 14),
            haptic: nil,
            when: { !$0 && $1 }
        )
    }

    @ViewBuilder
    private func grabButton(_ release: BookRelease) -> some View {
        if grabbed.contains(release.guid) {
            Label("Grabbed", systemImage: "checkmark").font(.caption2.weight(.bold)).foregroundStyle(Theme.seed)
                .transition(.rawkoonSwap)
        } else if grabbing == release.guid {
            ProgressView().tint(Theme.apricot)
                .transition(.rawkoonSwap)
        } else {
            Button("Grab") { Task { await grab(release) } }
                .font(.caption.weight(.bold)).foregroundStyle(Theme.onAccent)
                .padding(.horizontal, 14)
                .frame(minHeight: 44)
                .background(Theme.terracotta, in: Capsule())
                .disabled(release.downloadUrl == nil && release.magnetUrl == nil)
                .requiresConnection(model.isOffline)
                .transition(.rawkoonSwap)
        }
    }

    private func sizeText(_ bytes: Int?) -> String {
        guard let bytes else { return "—" }
        return ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }

    // MARK: Actions

    private func start() async {
        guard let client = model.api() else { errorMessage = String(localized: "Not logged in."); loading = false; return }
        // Offline, both calls would only fail; the search runs once the connection is back.
        guard !model.isOffline else { loading = false; return }
        loading = true
        errorMessage = nil
        // Ensure the edition exists (400 if it already does — that's fine).
        try? await client.addBookEdition(bookId: bookId, kind: kind)
        do {
            releases = try await client.bookReleaseSearch(bookId: bookId, kind: kind).releases
        } catch APIError.unauthorized {
            errorMessage = String(localized: "Admin only.")
        } catch {
            errorMessage = String(localized: "Could not search releases.")
        }
        loading = false
    }

    private func grab(_ release: BookRelease) async {
        guard let client = model.api() else { return }
        grabbing = release.guid
        defer { grabbing = nil }
        do {
            try await client.bookGrab(bookId: bookId, kind: kind, body: BookGrabBody(
                releaseTitle: release.title,
                downloadUrl: release.downloadUrl,
                magnetUrl: release.magnetUrl,
                indexer: release.indexer
            ))
            grabbed.insert(release.guid)
            grabError = nil
            await model.libraryStore.loadLibrary()
        } catch {
            grabError = String(localized: "Grab refused (already downloading?).")
        }
    }
}
