import Combine
import RawkoonKit
import SwiftUI
import UIKit

/// iPhone root: each tab's stack is mounted on first visit and kept alive, so
/// switching tabs keeps its navigation history and scroll position. The bar and
/// mini player float over the tabs; each tab's navigation controller gets a
/// matching bottom safe-area inset so its lists clear them.
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
    /// Measured height of the bar area, applied to each tab's navigation controller.
    @State private var chromeHeight: CGFloat = 0
    @State private var containerWidth: CGFloat = 393
    /// One geometry for the mini player's two spots, so it slides between them.
    @Namespace private var miniPlayerSpace

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
        .background(NavigationBottomInset(bottom: keyboardShown ? 0 : chromeHeight, mountedTabs: visited.count))
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { containerWidth = $0 }
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

    private var insets: TabBarLayout.Insets {
        TabBarLayout.insets(containerWidth: containerWidth, slots: RootTab.phone.count)
    }

    private var hasActiveBook: Bool {
        model.activeBook() != nil
    }

    /// Always sized as if expanded; collapsing only redraws inside it, so the lists'
    /// margins never change and nothing re-anchors or clamps when the bar changes.
    private var bottomChrome: some View {
        ZStack(alignment: .bottomLeading) {
            chromeStack(collapsed: false, sizing: true)
                .hidden()
                .accessibilityHidden(true)
                .allowsHitTesting(false)
            chromeStack(collapsed: chrome.isCollapsed, sizing: false)
        }
        .padding(.horizontal, insets.margin)
        .padding(.bottom, 4)
    }

    /// `sizing` is the hidden copy that reserves height; it must not claim the
    /// mini player's matched geometry.
    private func chromeStack(collapsed: Bool, sizing: Bool) -> some View {
        VStack(spacing: 8) {
            if hasActiveBook, !collapsed {
                miniPlayer(matched: !sizing)
            }
            HStack(spacing: 8) {
                RawkoonTabBar(
                    tabs: RootTab.phone,
                    selection: $selection,
                    isCollapsed: collapsed,
                    unreadLabel: NotificationBadge.label(forUnread: model.unreadNotificationCount),
                    initials: model.userInitials,
                    onExpand: { chrome.expand() },
                    onReselect: { stackResets[$0, default: 0] += 1 },
                    horizontalPadding: insets.padding
                )
                .fixedSize(horizontal: collapsed, vertical: false)
                if hasActiveBook, collapsed {
                    miniPlayer(matched: !sizing)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private func miniPlayer(matched: Bool) -> some View {
        let player = MiniPlayerView(model: model, onExpand: onExpandPlayer)
            .frame(maxWidth: .infinity)
            .background(Capsule().fill(Theme.raised))
            .overlay(Capsule().strokeBorder(Theme.borderStrong, lineWidth: 1))
            .shadow(color: .black.opacity(0.4), radius: 12, y: 6)
        if matched {
            // Identity transition: the incoming copy starts at the outgoing one's
            // frame and springs to its own, a slide instead of a crossfade.
            player
                .matchedGeometryEffect(id: "miniPlayer", in: miniPlayerSpace)
                .transition(.identity)
        } else {
            player
        }
    }
}
