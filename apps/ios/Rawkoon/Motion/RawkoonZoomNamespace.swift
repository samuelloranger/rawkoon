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

private struct ZoomSourceModifier: ViewModifier {
    let id: RawkoonZoom.ID?
    @Environment(\.rawkoonZoomNamespace) private var namespace

    func body(content: Content) -> some View {
        if let id, let namespace {
            content.matchedTransitionSource(id: id, in: namespace)
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
