import SwiftUI

/// SF Symbol + tint per `NotificationType` (web: `NotificationLeadingVisual.tsx`
/// `typeConfig`) — used when a notification has no `image_url`/`imageUrl`.
private struct NotificationTypeStyle {
    let systemImage: String
    let tint: Color
}

private let libraryStyle = NotificationTypeStyle(systemImage: "arrow.down.circle", tint: Theme.seed)
private let grabStyle = NotificationTypeStyle(systemImage: "arrow.up.circle", tint: Theme.importing)
private let failStyle = NotificationTypeStyle(systemImage: "exclamationmark.triangle", tint: Theme.terracotta)
private let bookStyle = NotificationTypeStyle(systemImage: "book", tint: Theme.apricot)
private let requestStyle = NotificationTypeStyle(systemImage: "tray.and.arrow.down", tint: Theme.apricotSoft)

private let typeStyles: [String: NotificationTypeStyle] = [
    "reminder": NotificationTypeStyle(systemImage: "clock", tint: Theme.apricot),
    "external": NotificationTypeStyle(systemImage: "dot.radiowaves.left.and.right", tint: Theme.importing),
    "app-update": NotificationTypeStyle(systemImage: "sparkles", tint: Theme.apricotSoft),
    "service_monitor": NotificationTypeStyle(systemImage: "display", tint: Theme.importing),
    "system": NotificationTypeStyle(systemImage: "gearshape", tint: Theme.muted),
    "request_pending": requestStyle,
    "request_decided": NotificationTypeStyle(systemImage: "tray.and.arrow.down", tint: Theme.importing),
    "request_available": NotificationTypeStyle(systemImage: "tray.and.arrow.down", tint: Theme.seed),
    "library_media_downloaded": libraryStyle,
    "library_media_grabbed": grabStyle,
    "library_download_failed": failStyle,
    "library_post_process_failed": failStyle,
    "library_grab_skipped": failStyle,
    "library_attention": failStyle,
    "book_grabbed": grabStyle,
    "book_downloaded": bookStyle,
    "book_import_failed": failStyle,
    "book_search_skipped": failStyle,
    "author_new_release": bookStyle,
    "movie_release_reminder": NotificationTypeStyle(systemImage: "bell", tint: Theme.apricot),
    "github-release": NotificationTypeStyle(systemImage: "sparkles", tint: Theme.apricotSoft),
    "test": NotificationTypeStyle(systemImage: "bell", tint: Theme.importing),
]

private func typeStyle(_ type: String, metadata: NotificationMetadata?) -> NotificationTypeStyle {
    if type == "external", metadata?.serviceName == "cross-seed" {
        return NotificationTypeStyle(systemImage: "leaf", tint: Theme.seed)
    }
    return typeStyles[type] ?? NotificationTypeStyle(systemImage: "gearshape", tint: Theme.muted)
}

/// The row's leading visual: the notification's poster/image when present,
/// else an SF Symbol keyed off its type (web: `NotificationLeadingVisual`).
struct NotificationLeadingVisual: View {
    @Environment(AppModel.self) private var model
    let type: String
    let metadata: NotificationMetadata?
    let imageUrl: String?

    private let size: CGFloat = 40

    var body: some View {
        if let url = model.absoluteURL(imageUrl) {
            AsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: {
                Theme.raised
            }
            .frame(width: size * 0.7, height: size)
            .clipShape(RoundedRectangle(cornerRadius: 8))
        } else {
            let style = typeStyle(type, metadata: metadata)
            RoundedRectangle(cornerRadius: 10)
                .fill(style.tint.opacity(0.16))
                .frame(width: size, height: size)
                .overlay {
                    Image(systemName: style.systemImage)
                        .foregroundStyle(style.tint)
                }
        }
    }
}
