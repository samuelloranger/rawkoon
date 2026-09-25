import SwiftUI
import UIKit

/// Gives every tab's navigation controller a bottom safe-area inset, as
/// UITabBarController does for its own bar. SwiftUI safe-area modifiers do not
/// cross into a NavigationStack, and content margins leak into horizontal rows
/// and sheets; a UIKit inset reaches the root and pushed screens and nothing else.
struct NavigationBottomInset: UIViewControllerRepresentable {
    let bottom: CGFloat
    /// Changes when a tab is first mounted, so its new stack gets the inset too.
    let mountedTabs: Int

    func makeUIViewController(context _: Context) -> Probe {
        Probe()
    }

    func updateUIViewController(_ probe: Probe, context _: Context) {
        probe.bottom = bottom
        probe.apply()
    }

    final class Probe: UIViewController {
        var bottom: CGFloat = 0

        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            apply()
        }

        /// Walks up to the hosting controller, then down through its children;
        /// presented sheets are not children, so they are left alone.
        func apply() {
            var root: UIViewController = self
            while let parent = root.parent {
                root = parent
            }
            for navigation in Self.navigationControllers(in: root)
                where navigation.additionalSafeAreaInsets.bottom != bottom
            {
                navigation.additionalSafeAreaInsets.bottom = bottom
            }
        }

        private static func navigationControllers(in controller: UIViewController) -> [UINavigationController] {
            let own = (controller as? UINavigationController).map { [$0] } ?? []
            return own + controller.children.flatMap { navigationControllers(in: $0) }
        }
    }
}
