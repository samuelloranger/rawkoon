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

    /// One mini player the layout moves between its two spots, so collapsing
    /// slides and resizes it rather than swapping copies. The height is always the
    /// expanded one, so the lists' margins never change when the bar does.
    private var bottomChrome: some View {
        TabChromeLayout(isCollapsed: chrome.isCollapsed) {
            RawkoonTabBar(
                tabs: RootTab.phone,
                selection: $selection,
                isCollapsed: chrome.isCollapsed,
                unreadLabel: NotificationBadge.label(forUnread: model.unreadNotificationCount),
                initials: model.userInitials,
                onExpand: { chrome.expand() },
                onReselect: { stackResets[$0, default: 0] += 1 },
                horizontalPadding: insets.padding
            )
            if hasActiveBook {
                MiniPlayerView(model: model, onExpand: onExpandPlayer)
                    .background(Capsule().fill(Theme.raised))
                    .overlay(Capsule().strokeBorder(Theme.borderStrong, lineWidth: 1))
                    .shadow(color: .black.opacity(0.4), radius: 12, y: 6)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .padding(.horizontal, insets.margin)
        .padding(.bottom, 4)
    }
}

/// The bar, then the mini player when a book is active, placed by `TabBarLayout.chrome`.
private struct TabChromeLayout: Layout {
    var isCollapsed: Bool

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout ()) -> CGSize {
        let width = proposal.replacingUnspecifiedDimensions().width
        return CGSize(width: width, height: chrome(width: width, subviews: subviews).height)
    }

    func placeSubviews(in bounds: CGRect, proposal _: ProposedViewSize, subviews: Subviews, cache _: inout ()) {
        let chrome = chrome(width: bounds.width, subviews: subviews)
        place(subviews[0], at: chrome.bar, in: bounds)
        if subviews.count > 1, let mini = chrome.miniPlayer {
            place(subviews[1], at: mini, in: bounds)
        }
    }

    private func chrome(width: CGFloat, subviews: Subviews) -> TabBarLayout.Chrome {
        // Collapsed, the bar takes its ideal width: the active slot alone.
        let bar = subviews[0].sizeThatFits(isCollapsed ? .unspecified : ProposedViewSize(width: width, height: nil))
        // Measured at full width so its height holds steady while it narrows.
        let mini: Double? = subviews.count > 1
            ? Double(subviews[1].sizeThatFits(ProposedViewSize(width: width, height: nil)).height)
            : nil
        return TabBarLayout.chrome(
            width: width,
            bar: TabBarLayout.Size(width: min(bar.width, width), height: bar.height),
            miniPlayerHeight: mini,
            collapsed: isCollapsed
        )
    }

    private func place(_ subview: LayoutSubview, at frame: TabBarLayout.Frame, in bounds: CGRect) {
        subview.place(
            at: CGPoint(x: bounds.minX + frame.x, y: bounds.minY + frame.y),
            anchor: .topLeading,
            proposal: ProposedViewSize(width: frame.width, height: frame.height)
        )
    }
}
