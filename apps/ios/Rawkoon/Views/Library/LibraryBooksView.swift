import RawkoonKit
import SwiftUI

struct LibraryBooksView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.horizontalSizeClass) private var hSizeClass
    @Bindable var state: LibraryBooksModel
    @State private var bookReloadTask: Task<Void, Never>?

    private var isRegularWidth: Bool {
        hSizeClass == .regular
    }

    var body: some View {
        VStack(spacing: 0) {
            booksToolbar
            booksGrid
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink { BookDiscoveryView() } label: {
                    Label("Explore books", systemImage: "trophy")
                }
            }
        }
        .onChange(of: model.bookChangeToken) { _, _ in
            bookReloadTask?.cancel()
            bookReloadTask = Task {
                await model.loadLibrary()
                await state.loadBookProgress(model: model)
            }
        }
        .navigationDestination(isPresented: Binding(
            get: { state.readingBook != nil },
            set: {
                if !$0 {
                    state.readingBook = nil
                }
            }
        )) {
            if let book = state.readingBook {
                BookView(book: book, preferEbook: true)
            }
        }
    }

    private var booksToolbar: some View {
        VStack(spacing: 8) {
            searchField("Search books", text: $state.bookSearch)
                .padding(.horizontal, 16)
            GlassEffectContainer(spacing: 8) {
                HStack(spacing: 8) {
                    filterMenu(title: state.bookKind.title, systemImage: "books.vertical") {
                        ForEach(BookKindFilter.allCases) { kind in
                            Button(kind.title) { state.bookKind = kind }
                        }
                    }
                    Spacer()
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
        }
    }

    private func filterMenu(
        title: LocalizedStringKey, systemImage: String,
        @ViewBuilder content: () -> some View
    ) -> some View {
        Menu {
            content()
        } label: {
            HStack(spacing: 5) {
                Image(systemName: systemImage).font(.caption2)
                Text(title).font(.subheadline.weight(.medium))
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold))
            }
            .foregroundStyle(Theme.textStrong)
            .padding(.horizontal, 12).padding(.vertical, 10)
            .glassEffect(.regular.interactive(), in: .capsule)
        }
    }

    @ViewBuilder
    private func bookLink(_ book: BookListItem, grid: Bool) -> some View {
        let menuItems = bookCardMenuItems(
            hasAudiobook: book.hasAudiobook,
            hasEbook: book.hasEbook,
            isAdmin: model.isAdmin,
            isRead: book.isRead,
            hasProgress: state.hasProgress(book),
            audiobookDownloaded: state.isDownloaded(book, model: model)
        )
        NavigationLink {
            BookView(book: book)
        } label: {
            Group {
                if grid {
                    BookGridCard(
                        book: book,
                        downloaded: state.isDownloaded(book, model: model),
                        progress: state.progressFraction(book),
                        menuItems: menuItems,
                        onMenuAction: { state.handleMenu($0, book: book, model: model) }
                    )
                } else {
                    BookRow(
                        book: book,
                        downloaded: state.isDownloaded(book, model: model),
                        progress: state.progressFraction(book),
                        menuItems: menuItems,
                        onMenuAction: { state.handleMenu($0, book: book, model: model) }
                    )
                }
            }
            .overlay(alignment: grid ? .topTrailing : .trailing) {
                if state.busyBookIds.contains(book.bookId) {
                    ProgressView().tint(Theme.muted).padding(grid ? 14 : 0).padding(.trailing, grid ? 0 : 10)
                        .transition(.rawkoonSwap)
                }
            }
        }
        .buttonStyle(.rawkoonPressable(scale: 0.98))
        .rawkoonScrollSettle()
    }

    private var booksGrid: some View {
        ScrollView {
            Group {
                if isRegularWidth {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 170, maximum: 230), spacing: 12)], spacing: 12) {
                        ForEach(state.filteredBooks(in: model)) { book in
                            bookLink(book, grid: true)
                        }
                    }
                } else {
                    LazyVStack(spacing: 8) {
                        ForEach(state.filteredBooks(in: model)) { book in
                            bookLink(book, grid: false)
                        }
                    }
                }
            }
            .padding(.horizontal, 16).padding(.top, 4)
        }
        .rawkoonMotion(RawkoonMotion.snappy, value: state.busyBookIds)
        .reportsTabBarScroll()
        .overlay {
            if model.loading, model.library.isEmpty {
                booksSkeleton
            } else if let booksError = state.booksError, model.library.isEmpty {
                ContentUnavailableView {
                    Label("Couldn't load books", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(booksError)
                } actions: {
                    Button("Try again") { Task { await state.loadBooks(model: model) } }
                        .buttonStyle(.bordered)
                        .tint(Theme.apricot)
                }
                .rawkoonLivingSymbol(.error)
            } else if !model.loading, state.filteredBooks(in: model).isEmpty {
                ContentUnavailableView(
                    "No books", systemImage: "books.vertical",
                    description: Text("Books added on your server show up here.")
                )
                .rawkoonLivingSymbol(.empty)
            }
        }
        .refreshable { await state.loadBooks(model: model) }
    }

    /// Warm skeleton rows matching `BookRow` while the first books page loads.
    private var booksSkeleton: some View {
        ScrollView {
            LazyVStack(spacing: 8) {
                ForEach(0 ..< 8, id: \.self) { _ in
                    HStack(spacing: 12) {
                        ShimmerView(cornerRadius: 10).frame(width: 56, height: 56)
                        VStack(alignment: .leading, spacing: 6) {
                            ShimmerView(cornerRadius: 4).frame(height: 15)
                            ShimmerView(cornerRadius: 4).frame(width: 120, height: 11)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(12)
                    .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1))
                }
            }
            .padding(.horizontal, 16).padding(.top, 4)
        }
        .allowsHitTesting(false)
    }
}
