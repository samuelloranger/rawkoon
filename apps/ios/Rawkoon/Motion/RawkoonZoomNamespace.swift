import RawkoonKit
import SwiftUI

extension EnvironmentValues {
    /// The single app-level namespace zoom sources and destinations share.
    @Entry var rawkoonZoomNamespace: Namespace.ID?
}

/// Applies `.navigationTransition(.zoom)` only when a namespace is present, so
/// a destination degrades to a normal push in previews or reduced contexts.
struct ZoomDestination: ViewModifier {
    let id: RawkoonZoom.ID
    let namespace: Namespace.ID?

    func body(content: Content) -> some View {
        if let namespace {
            content.navigationTransition(.zoom(sourceID: id, in: namespace))
        } else {
            content
        }
    }
}
