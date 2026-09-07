@testable import RawkoonKit
import XCTest

final class ContextMenuItemsTests: XCTestCase {
    func testNonAdminNeverGetsAddOrRemove() {
        let media = mediaPosterMenuItems(inLibrary: true, isAdmin: false)
        XCTAssertFalse(media.contains(.removeFromLibrary))
        XCTAssertFalse(media.contains(.toggleMonitored))

        let book = bookCardMenuItems(
            hasAudiobook: false, hasEbook: true, isAdmin: false, isRead: false
        )
        XCTAssertFalse(book.contains(.addAudiobook))
        XCTAssertFalse(book.contains(.addEbook))
    }

    func testBookWithBothEditionsOffersReadAndPlay() {
        let items = bookCardMenuItems(
            hasAudiobook: true, hasEbook: true, isAdmin: true, isRead: false
        )
        XCTAssertTrue(items.contains(.read))
        XCTAssertTrue(items.contains(.play))
        XCTAssertTrue(items.contains(.markRead))
        XCTAssertFalse(items.contains(.markUnread))
        XCTAssertFalse(items.contains(.addAudiobook))
        XCTAssertFalse(items.contains(.addEbook))
    }

    func testBookWithNoAudiobookOffersAddAudiobook() {
        let items = bookCardMenuItems(
            hasAudiobook: false, hasEbook: true, isAdmin: true, isRead: false
        )
        XCTAssertTrue(items.contains(.addAudiobook))
        XCTAssertFalse(items.contains(.addEbook))
        XCTAssertTrue(items.contains(.read))
        XCTAssertFalse(items.contains(.play))
    }

    func testReadBookOffersMarkUnreadInsteadOfMarkRead() {
        let items = bookCardMenuItems(
            hasAudiobook: true, hasEbook: true, isAdmin: false, isRead: true
        )
        XCTAssertTrue(items.contains(.markUnread))
        XCTAssertFalse(items.contains(.markRead))
    }
}
