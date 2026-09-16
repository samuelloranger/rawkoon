import Foundation

enum LibraryNotification {
    static func mediaID(in notification: StreamNotificationDTO) -> Int? {
        guard notification.type.hasPrefix("library") else { return nil }
        if let id = notification.metadata?.mediaId {
            return id
        }
        return id(inPath: notification.url, after: "library")
    }

    static func bookID(in notification: StreamNotificationDTO) -> Int? {
        guard notification.type.hasPrefix("book") else { return nil }
        if let id = notification.metadata?.bookId {
            return id
        }
        return id(inPath: notification.url, after: "books")
    }

    static func isSilent(_ notification: StreamNotificationDTO) -> Bool {
        notification.metadata?.silent == true
    }

    @MainActor
    static func apply(_ notification: StreamNotificationDTO, to store: ServerStateStore) {
        if let mediaID = mediaID(in: notification) {
            store.invalidate(.libraryItem(mediaID))
        }
        if let bookID = bookID(in: notification) {
            store.invalidate(.bookItem(bookID))
        }
    }

    private static func id(inPath url: String?, after segment: String) -> Int? {
        guard let url else { return nil }
        let path = url.split(separator: "?", maxSplits: 1).first.map(String.init) ?? url
        let parts = path.split(separator: "/").map(String.init)
        guard let index = parts.firstIndex(of: segment), index + 1 < parts.count else {
            return nil
        }
        return Int(parts[index + 1])
    }
}
