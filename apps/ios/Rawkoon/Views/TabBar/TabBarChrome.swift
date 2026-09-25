import RawkoonKit
import SwiftUI

/// Collapse state for the custom iPhone tab bar, fed by the active tab's root list.
@Observable
final class TabBarChrome {
    private(set) var isCollapsed = false
    private var scroll = TabBarScrollState()

    func scrolled(to offset: Double, maxOffset: Double) {
        scroll.update(offset: offset, maxOffset: maxOffset)
        sync()
    }

    func expand() {
        scroll.expand()
        sync()
    }

    /// A tab switch starts from the new tab's own list, expanded.
    func reset() {
        scroll = TabBarScrollState()
        sync()
    }

    private func sync() {
        guard scroll.isCollapsed != isCollapsed else { return }
        withAnimation(.spring(duration: 0.35)) { isCollapsed = scroll.isCollapsed }
    }
}

extension EnvironmentValues {
    @Entry var tabBarChrome: TabBarChrome?
    /// False for a kept-alive iPhone tab that is not on screen; true elsewhere.
    @Entry var isActiveRootTab = true
}

extension View {
    /// Put on a tab's root scroll container so the custom bar can shrink with it.
    func reportsTabBarScroll() -> some View {
        modifier(TabBarScrollReporter())
    }
}

private struct TabBarScrollReporter: ViewModifier {
    @Environment(\.tabBarChrome) private var chrome

    func body(content: Content) -> some View {
        content.onScrollGeometryChange(for: ScrollSample.self) { geometry in
            let top = geometry.contentInsets.top
            return ScrollSample(
                offset: geometry.contentOffset.y + top,
                maxOffset: geometry.contentSize.height - geometry.containerSize.height
                    + geometry.contentInsets.bottom + top
            )
        } action: { _, sample in
            chrome?.scrolled(to: sample.offset, maxOffset: sample.maxOffset)
        }
    }
}

private struct ScrollSample: Equatable {
    let offset: Double
    let maxOffset: Double
}
