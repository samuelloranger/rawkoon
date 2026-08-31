import XCTest
@testable import RawkoonKit

final class ContextMenuItemsTests: XCTestCase {
    func testNonAdminNeverGetsAddOrRemove() {
        let media = mediaPosterMenuItems(inLibrary: true, isAdmin: false)
        XCTAssertFalse(media.contains(.removeFromLibrary))
        XCTAssertFalse(media.contains(.toggleMonitored))

        let book = bookCardMenuItems(hasAudiobook: false, hasEbook: true, isAdmin: false)
        XCTAssertFalse(book.contains(.addAudiobook))
        XCTAssertFalse(book.contains(.addEPUB))
    }

    func testBookWithBothEditionsOffersReadAndPlay() {
        let items = bookCardMenuItems(hasAudiobook: true, hasEbook: true, isAdmin: true)
        XCTAssertTrue(items.contains(.read))
        XCTAssertTrue(items.contains(.play))
        XCTAssertFalse(items.contains(.addAudiobook))
        XCTAssertFalse(items.contains(.addEPUB))
    }

    func testBookWithNoAudiobookOffersAddAudiobook() {
        let items = bookCardMenuItems(hasAudiobook: false, hasEbook: true, isAdmin: true)
        XCTAssertTrue(items.contains(.addAudiobook))
        XCTAssertFalse(items.contains(.addEPUB))
        XCTAssertTrue(items.contains(.read))
        XCTAssertFalse(items.contains(.play))
    }
}
