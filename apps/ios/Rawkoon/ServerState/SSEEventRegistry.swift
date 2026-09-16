import Foundation

enum SSEContractID: String, CaseIterable, Sendable {
    case libraryMediaUpdate = "library.media-update"
    case libraryBookUpdate = "library.book-update"
    case libraryHandshake = "library.handshake"
    case notification = "notifications.notification"
    case notificationsHandshake = "notifications.handshake"
    case libraryMigrateStatus = "library.migrate-status"
    case adminJobsStatus = "admin.jobs-status"
}

enum SSEContractEvent: Sendable {
    case media(id: Int)
    case book(id: Int)
    case libraryHandshake
    case notification
    case notificationsHandshake
    case libraryMigrateStatus(state: String)
    case adminJobsStatus

    var contractID: SSEContractID {
        switch self {
        case .media: .libraryMediaUpdate
        case .book: .libraryBookUpdate
        case .libraryHandshake: .libraryHandshake
        case .notification: .notification
        case .notificationsHandshake: .notificationsHandshake
        case .libraryMigrateStatus: .libraryMigrateStatus
        case .adminJobsStatus: .adminJobsStatus
        }
    }
}

enum SSEEventRegistry {
    static var handledContractIDs: Set<String> {
        Set(SSEContractID.allCases.map(\.rawValue))
    }

    @MainActor
    static func apply(_ event: SSEContractEvent, to store: ServerStateStore) {
        switch event {
        case let .media(id):
            store.invalidate(.libraryItem(id))
        case let .book(id):
            store.invalidate(.bookItem(id))
        case .libraryHandshake:
            store.invalidateAllLibraryLists()
            store.invalidate(.bookList)
            store.invalidate(.progress)
        case .notification:
            store.invalidate(.notifications)
            store.invalidate(.unreadCount)
        case .notificationsHandshake:
            break
        case .libraryMigrateStatus:
            break
        case .adminJobsStatus:
            break
        }
    }

    @MainActor
    static func applyUnknownEvent(streamPath: String, to store: ServerStateStore) {
        Log.sync.warning("Unknown SSE event on \(streamPath, privacy: .public), performing conservative invalidation")
        if streamPath.contains("library") {
            store.invalidateAllLibraryLists()
        } else if streamPath.contains("notifications") {
            store.invalidate(.notifications)
            store.invalidate(.unreadCount)
        }
    }
}
