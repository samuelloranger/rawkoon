import SwiftUI

/// Transient top banner for a live notification (spec T4) — the iOS analog of
/// the web app's `NotificationToastContainer`. `AppModel` owns the show/dismiss
/// timing (`bannerNotification`, auto-cleared after a few seconds); this view
/// is presentation plus tap-to-navigate and swipe-up-to-dismiss.
struct NotificationBannerView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let notification: StreamNotificationDTO

    @State private var dragOffset: CGFloat = 0
    @State private var predictedEnd: CGFloat = 0
    /// Resets on cancel as well as on release, so an interrupted drag can't leave the banner held.
    @GestureState private var isTouching = false
    /// Banner's bottom edge in global space, so a fling clears the screen top exactly.
    @State private var bottomEdge: CGFloat = 120

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
                    // A 44pt hit area without growing the banner.
                    .padding(17)
                    .contentShape(Rectangle())
                    .padding(-17)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close")
        }
        .padding(12)
        .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 14))
        .padding(.horizontal, 16)
        .onGeometryChange(for: CGFloat.self) { $0.frame(in: .global).maxY } action: { bottomEdge = $0 }
        .offset(y: dragOffset)
        .gesture(swipeToDismiss)
        .onChange(of: notification.id) { dragOffset = 0 }
        .onChange(of: isTouching) { _, touching in
            if touching {
                model.holdBanner()
            } else if dragOffset < -40 || predictedEnd < -80 {
                flingAway()
            } else {
                // motion-ok: already gates on Reduce Motion here
                withAnimation(reduceMotion ? RawkoonMotion.reduced : RawkoonMotion.snappy) { dragOffset = 0 }
                model.releaseBanner()
            }
        }
    }

    private var swipeToDismiss: some Gesture {
        DragGesture(minimumDistance: 8)
            .updating($isTouching) { _, touching, _ in touching = true }
            .onChanged { value in
                let drag = value.translation.height
                // Free upward, resisted downward so the banner can't be pulled into the content.
                dragOffset = drag < 0 ? drag : drag / (1 + drag / 40)
                predictedEnd = value.predictedEndTranslation.height
            }
    }

    private func flingAway() {
        let id = notification.id
        // Only dismiss the banner that was flung, not one that replaced it mid-animation.
        let dismissIfStillShown = {
            if model.bannerNotification?.id == id {
                model.dismissBanner()
            }
        }
        if reduceMotion {
            // motion-ok: already gates on Reduce Motion here
            withAnimation(RawkoonMotion.reduced) { dismissIfStillShown() }
            return
        }
        // motion-ok: already gates on Reduce Motion here
        withAnimation(RawkoonMotion.deckFling) {
            dragOffset = -(bottomEdge + 20)
        } completion: {
            dismissIfStillShown()
        }
    }
}
