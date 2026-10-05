import SwiftUI

extension View {
    /// Caps pushed pages to a readable measure and centers them at regular width; no-op on phone.
    func readableWidth(_ maxWidth: CGFloat = 720) -> some View {
        modifier(ReadableWidth(maxWidth: maxWidth))
    }

    /// Hides the sheet grabber on Mac Catalyst, where sheets can't be drag-dismissed.
    func sheetGrabber() -> some View {
        #if targetEnvironment(macCatalyst)
            presentationDragIndicator(.hidden)
        #else
            presentationDragIndicator(.visible)
        #endif
    }
}

private struct ReadableWidth: ViewModifier {
    let maxWidth: CGFloat
    @Environment(\.horizontalSizeClass) private var hSizeClass

    func body(content: Content) -> some View {
        if hSizeClass == .regular {
            content.frame(maxWidth: maxWidth).frame(maxWidth: .infinity)
        } else {
            content
        }
    }
}
