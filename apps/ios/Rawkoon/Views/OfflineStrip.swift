import SwiftUI
import UIKit

/// Slim notice across the top of every tab while the phone has no connection:
/// what is on screen is the saved copy, and server actions are paused.
struct OfflineStrip: View {
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "wifi.slash")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.apricot)
            Text("Offline · actions paused")
                .font(.caption.weight(.medium))
                .foregroundStyle(Theme.text)
                .lineLimit(1)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 7)
        .background(Theme.raised, in: Capsule())
        .overlay(Capsule().strokeBorder(Theme.border, lineWidth: 1))
        .frame(maxWidth: .infinity)
        .padding(.top, 2)
        .padding(.bottom, 6)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isStaticText)
    }
}

extension View {
    /// Pins the offline strip above the content while the phone is offline.
    func offlineStrip(isOffline: Bool) -> some View {
        safeAreaInset(edge: .top, spacing: 0) {
            if isOffline {
                OfflineStrip()
                    .transition(.rawkoonEdge(.top))
            }
        }
        .rawkoonMotion(RawkoonMotion.spring, value: isOffline)
    }

    /// Dims a control that needs the server while the phone has no connection,
    /// and answers a tap on it with why instead of a dead press. Inside system
    /// menus and swipe actions only the disabled state applies.
    func requiresConnection(_ isOffline: Bool) -> some View {
        modifier(RequiresConnection(isOffline: isOffline))
    }
}

private struct RequiresConnection: ViewModifier {
    let isOffline: Bool

    func body(content: Content) -> some View {
        content
            .disabled(isOffline)
            .opacity(isOffline ? 0.45 : 1)
            .overlay {
                if isOffline {
                    Color.clear
                        .contentShape(Rectangle())
                        .onTapGesture { OfflineFeedback.explain() }
                        .accessibilityElement()
                        .accessibilityLabel("You're offline. This needs a connection.")
                        .accessibilityAddTraits(.isButton)
                }
            }
    }
}

/// The one message every blocked server action gives, from any screen.
enum OfflineFeedback {
    static func explain() {
        RawkoonHaptics.play(.warning)
        AppModel.shared.toast(String(localized: "You're offline. This needs a connection."), style: .info)
    }

    /// Wraps a swipe or dialog action, which no overlay can intercept, so an
    /// offline tap explains itself instead of running.
    static func gate(_ isOffline: Bool, _ action: @escaping () -> Void) -> () -> Void {
        { isOffline ? explain() : action() }
    }
}
