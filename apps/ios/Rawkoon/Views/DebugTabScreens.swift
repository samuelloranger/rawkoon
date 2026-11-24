#if DEBUG
    // motion-ok-file: debug-only harness
    import RawkoonKit
    import SwiftUI

    /// `RAWKOON_SCREEN=tabContainer`: the real iPhone container over mock lists.
    /// `RAWKOON_TABBAR_BOTTOM=1` starts the list at its end, which collapses the
    /// bar through the real scroll path and shows whether the last row clears it.
    /// `RAWKOON_TABBAR_PLAYING=1` loads a synthetic audiobook so the mini player shows.
    /// `RAWKOON_TABBAR_DEMO=1` switches tabs, then scrolls down and back up, for a
    /// screen recording of the transitions.
    struct DebugTabContainer: View {
        @Environment(AppModel.self) private var model
        @State private var selection = RootTab.books
        @State private var demoScrollTarget: Int?
        private let atBottom = ProcessInfo.processInfo.environment["RAWKOON_TABBAR_BOTTOM"] != nil
        private let playing = ProcessInfo.processInfo.environment["RAWKOON_TABBAR_PLAYING"] != nil
        private let demo = ProcessInfo.processInfo.environment["RAWKOON_TABBAR_DEMO"] != nil

        var body: some View {
            // Rendered once the synthetic book is active, so the list anchors with the final inset.
            Group {
                if !playing || model.activeEditionId != nil {
                    container
                } else {
                    Theme.base
                }
            }
            .onAppear(perform: loadPlayingBook)
            .task { await runDemo() }
        }

        private func runDemo() async {
            guard demo else { return }
            let pause = Duration.milliseconds(1400)
            try? await Task.sleep(for: .seconds(2))
            for tab in [RootTab.home, .settings, .books] {
                withAnimation(.spring(duration: 0.35, bounce: 0.2)) { selection = tab }
                try? await Task.sleep(for: pause)
            }
            for row in [40, 1, 40, 1] {
                demoScrollTarget = row
                try? await Task.sleep(for: pause)
            }
        }

        private var container: some View {
            PhoneTabsView(selection: $selection, onExpandPlayer: {}) { tab in
                NavigationStack {
                    ScrollViewReader { proxy in
                        ScrollView {
                            LazyVStack(spacing: 10) {
                                ForEach(1 ... 40, id: \.self) { row in
                                    Text(verbatim: "Row \(row)")
                                        .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
                                        .padding(.horizontal, 14)
                                        .background(RoundedRectangle(cornerRadius: 14).fill(Theme.raised))
                                        .id(row)
                                }
                            }
                            .padding(.horizontal, 16)
                        }
                        .reportsTabBarScroll()
                        .background(Theme.base)
                        .navigationTitle(Text(tab.title))
                        // Scrolled after layout, the way a user lands at the end.
                        .task {
                            guard atBottom else { return }
                            try? await Task.sleep(for: .milliseconds(500))
                            withAnimation { proxy.scrollTo(40, anchor: .bottom) }
                        }
                        .onChange(of: demoScrollTarget) { _, row in
                            guard let row, tab == selection else { return }
                            withAnimation(.easeInOut(duration: 0.8)) {
                                proxy.scrollTo(row, anchor: row == 1 ? .top : .bottom)
                            }
                        }
                    }
                }
            }
        }

        private func loadPlayingBook() {
            guard playing, model.activeEditionId == nil,
                  let manifest = DebugPlayer.syntheticManifest(chapterCount: 12),
                  let baseURL = URL(string: "https://screenshot.invalid")
            else { return }
            model.libraryStore.library = [BookListItem(
                bookId: manifest.bookId, title: manifest.title, author: manifest.authors.first,
                coverURL: nil, audiobookEditionId: manifest.editionId, ebookEditionId: nil,
                audiobookDurationSecs: manifest.totalDurationSecs, audiobookStatus: "downloaded",
                audiobookFileCount: manifest.files.count, hasEbook: false, readAt: nil
            )]
            model.manifests[manifest.editionId] = manifest
            model.activeEditionId = manifest.editionId
            model.player.load(manifest: manifest, baseURL: baseURL, resumeAt: 1800)
        }
    }

    /// `RAWKOON_SCREEN=tabBar`: the custom bar's states for screenshot review.
    struct DebugTabBarStates: View {
        @State private var home = RootTab.home
        @State private var books = RootTab.books

        var body: some View {
            VStack(spacing: 28) {
                Spacer()
                RawkoonTabBar(tabs: RootTab.phone, selection: $home, isCollapsed: false,
                              unreadLabel: "3", initials: "SL", onExpand: {})
                RawkoonTabBar(tabs: RootTab.phone, selection: $books, isCollapsed: false,
                              unreadLabel: "9+", initials: nil, onExpand: {})
                HStack {
                    RawkoonTabBar(tabs: RootTab.phone, selection: $books, isCollapsed: true,
                                  unreadLabel: nil, initials: "SL", onExpand: {})
                        .fixedSize()
                    Spacer()
                }
                Spacer()
            }
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.base)
        }
    }
#endif
