import Combine
import RawkoonKit
import SwiftUI
import UIKit

/// iPhone root: each tab's stack is mounted on first visit and kept alive, so
/// switching tabs keeps its navigation history and scroll position. The bar and
/// mini player live in the bottom safe-area inset, so every list clears them.
struct PhoneTabsView<Root: View>: View {
    @Environment(AppModel.self) private var model
    @Binding var selection: RootTab
    let onExpandPlayer: () -> Void
    @ViewBuilder let root: (RootTab) -> Root

    @State private var chrome = TabBarChrome()
    @State private var visited: Set<RootTab> = []
    /// Bumped on a re-tap of the shown tab, which rebuilds its stack at the root.
    @State private var stackResets: [RootTab: Int] = [:]
    /// The bar rides the keyboard otherwise, and a tab switch would leave the
    /// hidden tab's field focused.
    @State private var keyboardShown = false

    var body: some View {
        ZStack {
            ForEach(RootTab.phone, id: \.self) { tab in
                if visited.contains(tab) || tab == selection {
                    let shown = tab == selection
                    root(tab)
                        .id(stackResets[tab, default: 0])
                        // Only the shown tab may drive the bar; a hidden list reloading must not.
                        .environment(\.tabBarChrome, shown ? chrome : nil)
                        .environment(\.isActiveRootTab, shown)
                        .opacity(shown ? 1 : 0)
                        .allowsHitTesting(shown)
                        .accessibilityHidden(!shown)
                }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if !keyboardShown {
                bottomChrome
            }
        }
        .onReceive(keyboardVisibility) { keyboardShown = $0 }
        .onAppear { visited.insert(selection) }
        .onChange(of: selection) { _, tab in
            visited.insert(tab)
            chrome.reset()
        }
    }

    private var keyboardVisibility: AnyPublisher<Bool, Never> {
        let center = NotificationCenter.default
        return Publishers.Merge(
            center.publisher(for: UIResponder.keyboardWillShowNotification).map { _ in true },
            center.publisher(for: UIResponder.keyboardWillHideNotification).map { _ in false }
        )
        .receive(on: DispatchQueue.main)
        .eraseToAnyPublisher()
    }

    private var hasActiveBook: Bool {
        model.activeBook() != nil
    }

    private var bottomChrome: some View {
        VStack(spacing: 8) {
            if hasActiveBook, !chrome.isCollapsed {
                miniPlayer
            }
            HStack(spacing: 8) {
                RawkoonTabBar(
                    tabs: RootTab.phone,
                    selection: $selection,
                    isCollapsed: chrome.isCollapsed,
                    unreadLabel: NotificationBadge.label(forUnread: model.unreadNotificationCount),
                    initials: model.userInitials,
                    onExpand: { chrome.expand() },
                    onReselect: { stackResets[$0, default: 0] += 1 }
                )
                .fixedSize(horizontal: chrome.isCollapsed, vertical: false)
                if hasActiveBook, chrome.isCollapsed {
                    miniPlayer
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 4)
    }

    private var miniPlayer: some View {
        MiniPlayerView(model: model, onExpand: onExpandPlayer)
            .frame(maxWidth: .infinity)
            .background(Capsule().fill(Theme.raised))
            .overlay(Capsule().strokeBorder(Theme.borderStrong, lineWidth: 1))
            .shadow(color: .black.opacity(0.4), radius: 12, y: 6)
    }
}
