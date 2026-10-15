import RawkoonKit
import SwiftUI
import UIKit

/// A compact, dismissible offer to continue from the book's other format. It
/// hides itself after `HandoffSuggestion.bannerLifetimeSecs` and never takes
/// more than its own row, so the page underneath stays readable.
struct HandoffBannerView: View {
    let systemImage: String
    let title: String
    let atMillis: Int64
    let snippet: String?
    let onAccept: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            Button(action: onAccept) {
                HStack(spacing: 10) {
                    Image(systemName: systemImage)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.apricot)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(title)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Theme.textStrong)
                            .lineLimit(1)
                        Text(detail)
                            .font(.caption)
                            .foregroundStyle(Theme.muted)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
                .padding(.leading, 16)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(title)
            .accessibilityValue(detail)
            .accessibilityHint(String(localized: "Double-tap to jump"))
            .accessibilityAddTraits(.isButton)

            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.muted)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(String(localized: "Dismiss"))
        }
        .glassEffect(.regular.tint(Theme.raised.opacity(0.85)).interactive(), in: .capsule)
        .padding(.horizontal, 16)
        .onAppear {
            UIAccessibility.post(notification: .announcement, argument: title)
        }
        .task {
            // A screen-reader or switch user needs longer than 12 s; it stays until closed or used.
            guard !Self.assistiveTechnologyRunning else { return }
            try? await Task.sleep(for: .seconds(HandoffSuggestion.bannerLifetimeSecs))
            guard !Task.isCancelled else { return }
            onDismiss()
        }
    }

    /// "2 min ago", then the matched sentence when there is one.
    private var detail: String {
        let when = Self.relative.localizedString(
            for: Date(timeIntervalSince1970: Double(atMillis) / 1000), relativeTo: Date()
        )
        guard let snippet else { return when }
        return "\(when) · \u{201C}\(snippet)\u{201D}"
    }

    private static var assistiveTechnologyRunning: Bool {
        UIAccessibility.isVoiceOverRunning || UIAccessibility.isSwitchControlRunning
    }

    private static let relative: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter
    }()
}
