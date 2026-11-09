import RawkoonKit
import SwiftUI

/// In-progress audiobooks and ebooks. Lives on the Home dashboard.
/// Self-loads, so any surface can host it.
struct ContinueListeningView: View {
    @Environment(AppModel.self) var model

    var refreshToken: Int = 0
    var limit: Int = 6
    /// Home bumps Continue+Listening refresh when the player sheet closes.
    var onPlaybackDismiss: (() -> Void)?

    @State private var items: [ContinueItem] = []
    @State private var listeningStats: ListeningStats?
    @State private var errorMessage: String?
    @State var openingID: String?
    @State var busyIds: Set<String> = []
    @State var showingPlayer = false
    @State var previewDocument: EbookPreviewDocument?
    @State var readingBook: BookListItem?

    var body: some View {
        // A bare `if` with no else renders nothing at all, and SwiftUI never
        // runs a `.task` attached to nothing — so the card stayed empty
        // forever, because the only thing that fills it is that task. The
        // zero-size placeholder keeps the view in the hierarchy while hidden.
        Group {
            if errorMessage != nil || !items.isEmpty {
                card
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                    .transition(.rawkoonSwap)
            } else {
                Color.clear.frame(width: 0, height: 0)
            }
        }
        // Before the first frame, so a saved card doesn't arrive late and push Home's rails through it.
        .onAppear { paintFromCache() }
        .task(id: refreshToken) { await load() }
        .sheet(isPresented: $showingPlayer, onDismiss: {
            onPlaybackDismiss?()
            Task { await load() }
        }) {
            if let active = model.activeBook() {
                PlayerView(summary: active.summary, manifest: active.manifest)
                    .environment(model)
            }
        }
        .sheet(item: $previewDocument, onDismiss: { Task { await load() } }) { document in
            EbookReaderSheet(document: document)
                .environment(model)
        }
        .navigationDestination(isPresented: Binding(
            get: { readingBook != nil },
            set: {
                if !$0 {
                    readingBook = nil
                }
            }
        )) {
            if let book = readingBook {
                BookView(book: book, preferEbook: true)
            }
        }
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("Continue", systemImage: "bookmark")
                    .font(.display(16))
                    .foregroundStyle(Theme.textStrong)
                Spacer()
                if let listeningStats {
                    NavigationLink {
                        ListeningStatsView(stats: listeningStats)
                    } label: {
                        HStack(spacing: 4) {
                            Text("Listening")
                            Image(systemName: "chevron.right")
                        }
                        .font(.caption.weight(.medium))
                        .foregroundStyle(Theme.apricotSoft)
                    }
                    .buttonStyle(.plain)
                }
            }

            if let errorMessage, items.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text(errorMessage)
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                    Button("Try again") {
                        Task { await load() }
                    }
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.apricot)
                    .frame(minHeight: 44)
                }
            } else {
                VStack(spacing: 10) {
                    ForEach(items.prefix(limit)) { item in
                        Button {
                            Task { await open(item) }
                        } label: {
                            row(item)
                        }
                        .buttonStyle(.rawkoonPressable(scale: 0.98))
                        .disabled(openingID != nil || busyIds.contains(item.id))
                        .bookCardContextMenu(
                            items: menuItems(for: item),
                            onAction: { handleMenu($0, item: item) }
                        )
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Theme.border, lineWidth: 1))
    }

    private func row(_ item: ContinueItem) -> some View {
        let opening = openingID == item.id || busyIds.contains(item.id)
        return HStack(spacing: 10) {
            poster(item)
            VStack(alignment: .leading, spacing: 3) {
                Text(title(item))
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text(subtitle(item))
                    .font(.caption2)
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
                Text(progressLabel(item))
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(Theme.faint)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            if opening {
                ProgressView().tint(Theme.muted)
            } else {
                Image(systemName: "arrow.right.circle")
                    .foregroundStyle(Theme.muted)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Theme.base.opacity(0.35), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.border, lineWidth: 1))
    }

    private func poster(_ item: ContinueItem) -> some View {
        Rectangle()
            .fill(Theme.base.opacity(0.7))
            .frame(width: 36, height: 54)
            .overlay {
                CachedAsyncImage(url: coverURL(item), targetSize: CGSize(width: 36, height: 54)) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Image(systemName: "book")
                        .foregroundStyle(Theme.faint)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Theme.border, lineWidth: 1))
    }

    // MARK: Copy

    private func coverURL(_ item: ContinueItem) -> URL? {
        switch item {
        case let .audiobook(audiobook): audiobook.coverURL
        case let .ebook(ebook): ebook.coverURL
        }
    }

    private func title(_ item: ContinueItem) -> String {
        switch item {
        case let .audiobook(audiobook): audiobook.title
        case let .ebook(ebook): ebook.title
        }
    }

    private func subtitle(_ item: ContinueItem) -> String {
        switch item {
        case let .audiobook(audiobook):
            let author = audiobook.author?.trimmingCharacters(in: .whitespacesAndNewlines)
            return (author?.isEmpty == false) ? "Audiobook · \(author!)" : "Audiobook"
        case let .ebook(ebook):
            let author = ebook.author?.trimmingCharacters(in: .whitespacesAndNewlines)
            return (author?.isEmpty == false) ? "Ebook · \(author!)" : "Ebook"
        }
    }

    private func progressLabel(_ item: ContinueItem) -> String {
        switch item {
        case let .audiobook(audiobook):
            let total = max(audiobook.totalDurationSecs, 1)
            let fraction = min(max(audiobook.positionSecs / total, 0), 1)
            return "\(Formatters.durationClock(audiobook.positionSecs)) / \(Formatters.durationClock(audiobook.totalDurationSecs)) · \(Int(fraction * 100))%"
        case let .ebook(ebook):
            let section = min(max(ebook.spineIndex + 1, 1), max(ebook.spineCount, 1))
            let fraction = Int(min(max(ebook.scrollFraction, 0), 1) * 100)
            return "Section \(section)/\(max(ebook.spineCount, 1)) · \(fraction)%"
        }
    }

    // MARK: Data

    func load() async {
        let widgetGeneration = WidgetSnapshotWriter.shared.generation
        guard let client = model.api() else {
            items = []
            errorMessage = nil
            return
        }
        async let listeningR = client.listeningStats()
        // Animated here: by now the card arrives after first paint, so Home's rails glide down instead of jumping.
        withRawkoonMotion(RawkoonMotion.spring) { paintFromCache() }
        if model.library.isEmpty {
            await model.loadLibrary()
        }
        async let audiobookProgressR = client.getProgress()
        async let ebookProgressR = client.readingProgress()
        let audiobookProgress = try? await audiobookProgressR
        let ebookProgress = try? await ebookProgressR
        if let stats = try? await listeningR {
            listeningStats = stats
            WidgetSnapshotWriter.shared.updateListening(stats, ifGeneration: widgetGeneration)
        }
        // Both failed: keep what is on screen rather than blanking the rail.
        guard audiobookProgress != nil || ebookProgress != nil else {
            if items.isEmpty {
                withRawkoonMotion(RawkoonMotion.spring) {
                    errorMessage = model.isOffline
                        ? String(localized: "This will load when you're back online.")
                        : String(localized: "Could not load continue progress.")
                }
            }
            return
        }
        withRawkoonMotion(RawkoonMotion.spring) {
            items = buildItems(
                audiobookProgress: audiobookProgress ?? client.cachedProgress()?.value ?? [],
                ebookProgress: ebookProgress ?? client.cachedReadingProgress()?.value ?? []
            )
            errorMessage = nil
        }
    }

    /// The saved copy paints first, so the rail never waits on the network.
    private func paintFromCache() {
        guard let client = model.api() else { return }
        if listeningStats == nil {
            listeningStats = client.cached(Endpoints.listeningStats)?.value
        }
        guard items.isEmpty else { return }
        let cachedAudio = client.cachedProgress()?.value
        let cachedEbook = client.cachedReadingProgress()?.value
        if cachedAudio != nil || cachedEbook != nil {
            items = buildItems(audiobookProgress: cachedAudio ?? [], ebookProgress: cachedEbook ?? [])
        }
    }

    private func buildItems(
        audiobookProgress: [RemoteProgress],
        ebookProgress: [ReadingPosition]
    ) -> [ContinueItem] {
        ContinueItem.build(audiobookProgress: audiobookProgress, ebookProgress: ebookProgress, library: model.library)
    }
}
