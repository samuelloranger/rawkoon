import RawkoonKit
import SwiftUI

extension EnvironmentValues {
    /// The single app-level namespace zoom sources and destinations share.
    @Entry var rawkoonZoomNamespace: Namespace.ID?
}

extension View {
    /// Marks this view as a zoom transition source when both an id and the app
    /// namespace are present; a no-op otherwise, so any call site is safe.
    func rawkoonZoomSource(_ id: RawkoonZoom.ID?) -> some View {
        modifier(ZoomSourceModifier(id: id))
    }

    /// Marks this view as the zoom destination for `id`.
    func rawkoonZoomDestination(_ id: RawkoonZoom.ID) -> some View {
        modifier(ZoomDestinationModifier(id: id))
    }
}

/// Zoom source ids as registered in the shared namespace.
nonisolated enum ZoomSourceKey {
    /// Kept-alive tabs share the namespace; a hidden tab's poster gets a distinct id so zooms use the visible one.
    static func id(_ id: String, inActiveTab: Bool) -> String {
        inActiveTab ? id : id + "#background"
    }
}

private struct ZoomSourceModifier: ViewModifier {
    let id: RawkoonZoom.ID?
    @Environment(\.rawkoonZoomNamespace) private var namespace
    @Environment(\.isActiveRootTab) private var isActiveRootTab

    func body(content: Content) -> some View {
        if let id, let namespace {
            // Same branch either way, so switching tabs never rebuilds the poster.
            content.matchedTransitionSource(id: ZoomSourceKey.id(id, inActiveTab: isActiveRootTab), in: namespace)
        } else {
            content
        }
    }
}

private struct ZoomDestinationModifier: ViewModifier {
    let id: RawkoonZoom.ID
    @Environment(\.rawkoonZoomNamespace) private var namespace

    func body(content: Content) -> some View {
        if let namespace {
            content.navigationTransition(.zoom(sourceID: id, in: namespace))
        } else {
            content
        }
    }
}
