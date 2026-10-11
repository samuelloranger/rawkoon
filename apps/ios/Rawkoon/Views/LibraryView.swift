import SwiftUI

struct LibraryView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.isActiveRootTab) private var isActiveRootTab
    @State private var section: LibrarySection
    @State private var mediaState = LibraryMediaModel()
    @State private var booksState = LibraryBooksModel()

    /// Desktop uses separate Media and Books tabs; phone uses the section picker.
    private let forcedSection: LibrarySection?

    init(forcedSection: LibrarySection? = nil) {
        self.forcedSection = forcedSection
        _section = State(initialValue: forcedSection ?? .media)
    }

    private var navigationTitleKey: LocalizedStringKey {
        switch forcedSection {
        case .media: "Movies & Shows"
        case .books: "Books"
        case nil: "Library"
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            if forcedSection == nil {
                Picker("Section", selection: $section) {
                    ForEach(LibrarySection.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
            }

            if model.isOfflineLibrary {
                offlineBanner
                    .transition(.rawkoonReveal)
            }

            if section == .media {
                LibraryMediaView(state: mediaState)
            } else {
                LibraryBooksView(state: booksState)
            }
        }
        .rawkoonMotion(RawkoonMotion.snappy, value: section)
        .rawkoonMotion(RawkoonMotion.spring, value: model.isOfflineLibrary)
        .background(Theme.base)
        .navigationTitle(navigationTitleKey)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if model.needsLibraryRefresh {
                await booksState.loadBooks(model: model)
            }
            await booksState.loadBookProgress(model: model)
        }
        .onChange(of: model.reconnectToken) { _, _ in
            Task { await booksState.loadBookProgress(model: model) }
        }
        .onChange(of: isActiveRootTab) { _, active in
            if active {
                Task { await booksState.loadBookProgress(model: model) }
            }
        }
        .onChange(of: section) { _, newSection in
            if newSection == .media {
                mediaState.liveReloadTask?.cancel()
                Task { await mediaState.load(reset: true, model: model) }
            } else {
                Task { await booksState.loadBookProgress(model: model) }
            }
        }
        .sheet(isPresented: $booksState.showingPlayer) {
            if let active = model.activeBook() {
                PlayerView(summary: active.summary, manifest: active.manifest)
                    .environment(model)
            }
        }
    }

    private var offlineBanner: some View {
        HStack(spacing: 8) {
            Image(systemName: "wifi.slash")
            Text("Offline — showing downloaded books")
            Spacer(minLength: 0)
        }
        .font(.caption)
        .foregroundStyle(Theme.muted)
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }
}
