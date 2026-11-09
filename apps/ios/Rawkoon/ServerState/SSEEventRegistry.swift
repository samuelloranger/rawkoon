import Foundation

enum SSEContractID: String, CaseIterable, Sendable {
    case libraryMediaUpdate = "library.media-update"
    case libraryBookUpdate = "library.book-update"
    case libraryLanded = "library.landed"
    case libraryDownloadProgress = "library.download-progress"
    case librarySeedState = "library.seed-state"
    case librarySearchResult = "library.search-result"
    case libraryHandshake = "library.handshake"
    case notification = "notifications.notification"
    case notificationsHandshake = "notifications.handshake"
    case libraryMigrateStatus = "library.migrate-status"
    case adminJobsStatus = "admin.jobs-status"
}

enum SSEContractEvent: Sendable {
    case media(id: Int)
    case book(id: Int)
    case landed(id: Int)
    case libraryHandshake
    case notification
    case notificationsHandshake
    case libraryMigrateStatus(state: String)
    case adminJobsStatus

    var contractID: SSEContractID {
        switch self {
        case .media: .libraryMediaUpdate
        case .book: .libraryBookUpdate
        case .landed: .libraryLanded
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
        case let .media(id), let .landed(id):
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
}
