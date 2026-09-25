import Combine
import RawkoonKit
import SwiftUI
import UIKit

/// iPhone root: each tab's stack is mounted on first visit and kept alive, so
/// switching tabs keeps its navigation history and scroll position. The bar and
/// mini player float over the tabs, and every scroll view gets a matching bottom
/// content margin so its last row clears them.
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
    /// Measured height of the bar area. A `safeAreaInset` here does not reach scroll
    /// views inside the tabs' navigation stacks; content margins do.
    @State private var chromeHeight: CGFloat = 0

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
        .contentMargins(.bottom, keyboardShown ? 0 : chromeHeight, for: .scrollContent)
        .contentMargins(.bottom, keyboardShown ? 0 : chromeHeight, for: .scrollIndicators)
        .overlay(alignment: .bottom) {
            if !keyboardShown {
                bottomChrome
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { chromeHeight = $0 }
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

    /// Always sized as if expanded; collapsing only redraws inside it, so the lists'
    /// margins never change and nothing re-anchors or clamps when the bar changes.
    private var bottomChrome: some View {
        ZStack(alignment: .bottomLeading) {
            chromeStack(collapsed: false)
                .hidden()
                .accessibilityHidden(true)
                .allowsHitTesting(false)
            chromeStack(collapsed: chrome.isCollapsed)
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 4)
    }

    private func chromeStack(collapsed: Bool) -> some View {
        VStack(spacing: 8) {
            if hasActiveBook, !collapsed {
                miniPlayer
            }
            HStack(spacing: 8) {
                RawkoonTabBar(
                    tabs: RootTab.phone,
                    selection: $selection,
                    isCollapsed: collapsed,
                    unreadLabel: NotificationBadge.label(forUnread: model.unreadNotificationCount),
                    initials: model.userInitials,
                    onExpand: { chrome.expand() },
                    onReselect: { stackResets[$0, default: 0] += 1 }
                )
                .fixedSize(horizontal: collapsed, vertical: false)
                if hasActiveBook, collapsed {
                    miniPlayer
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var miniPlayer: some View {
        MiniPlayerView(model: model, onExpand: onExpandPlayer)
            .frame(maxWidth: .infinity)
            .background(Capsule().fill(Theme.raised))
            .overlay(Capsule().strokeBorder(Theme.borderStrong, lineWidth: 1))
            .shadow(color: .black.opacity(0.4), radius: 12, y: 6)
    }
}
