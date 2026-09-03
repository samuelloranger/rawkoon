import SwiftUI

/// Transient top banner for a live notification (spec T4) — the iOS analog of
/// the web app's `NotificationToastContainer`. `AppModel` owns the show/dismiss
/// timing (`bannerNotification`, auto-cleared after a few seconds); this view
/// is presentation plus tap-to-navigate.
struct NotificationBannerView: View {
    @Environment(AppModel.self) private var model
    let notification: StreamNotificationDTO

    var body: some View {
        Button {
            model.dismissBanner()
            model.navigate(toNotificationUrl: notification.url)
        } label: {
            HStack(alignment: .top, spacing: 12) {
                NotificationLeadingVisual(
                    type: notification.type, metadata: notification.metadata, imageUrl: notification.imageUrl
                )
                VStack(alignment: .leading, spacing: 2) {
                    Text(notification.title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.textStrong)
                        .lineLimit(1)
                    Text(notification.body)
                        .font(.caption)
                        .foregroundStyle(Theme.muted)
                        .lineLimit(2)
                }
                Spacer(minLength: 0)
                Button {
                    model.dismissBanner()
                } label: {
                    Image(systemName: "xmark")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Theme.faint)
                }
                .buttonStyle(.plain)
            }
            .padding(12)
            .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1))
            .shadow(color: .black.opacity(0.35), radius: 12, y: 6)
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 16)
    }
}
