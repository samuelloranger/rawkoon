import SwiftUI

/// Transient top banner for a live notification (spec T4) — the iOS analog of
/// the web app's `NotificationToastContainer`. `AppModel` owns the show/dismiss
/// timing (`bannerNotification`, auto-cleared after a few seconds); this view
/// is presentation plus tap-to-navigate.
struct NotificationBannerView: View {
    @Environment(AppModel.self) private var model
    let notification: StreamNotificationDTO

    var body: some View {
        // The navigate area and the dismiss button are SIBLINGS, not nested:
        // a `Button` inside another `Button` delivers the tap to both on iOS, so
        // tapping the xmark would also fire the navigation. The row body uses a
        // tap gesture over its content shape; only the xmark is a real Button.
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
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
            .onTapGesture {
                model.dismissBanner()
                model.navigate(toNotificationUrl: notification.url)
            }
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
        .padding(.horizontal, 16)
    }
}
