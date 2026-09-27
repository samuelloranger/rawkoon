import SwiftUI

/// Slim notice across the top of every tab while the phone has no connection:
/// what is on screen is the saved copy, and server actions are paused.
struct OfflineStrip: View {
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "wifi.slash")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.apricot)
            Text("Offline · showing saved data")
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
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .rawkoonMotion(RawkoonMotion.spring, value: isOffline)
    }

    /// Disables a control that needs the server while the phone has no
    /// connection. The offline strip explains why; the control stays visible so
    /// the screen keeps its shape.
    func requiresConnection(_ isOffline: Bool) -> some View {
        disabled(isOffline)
            .opacity(isOffline ? 0.45 : 1)
    }
}
