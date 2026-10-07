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

    func testOnlyOpenDetailsWorksOfflineInTheMediaMenu() {
        let items = mediaPosterMenuItems(inLibrary: true, isAdmin: true)
        XCTAssertEqual(items, [.toggleMonitored, .searchReleases, .openDetails, .removeFromLibrary])
        XCTAssertEqual(items.filter { !$0.requiresConnection }, [.openDetails])
    }

    func testAutoSearchSitsAboveSearchReleasesForAdminsOnly() {
        let admin = mediaPosterMenuItems(inLibrary: true, isAdmin: true, canAutoSearch: true)
        XCTAssertEqual(admin, [.toggleMonitored, .autoSearch, .searchReleases, .openDetails, .removeFromLibrary])

        let member = mediaPosterMenuItems(inLibrary: true, isAdmin: false, canAutoSearch: true)
        XCTAssertFalse(member.contains(.autoSearch))
        let notInLibrary = mediaPosterMenuItems(inLibrary: false, isAdmin: true, canAutoSearch: true)
        XCTAssertFalse(notInLibrary.contains(.autoSearch))
        XCTAssertTrue(MediaPosterMenuAction.autoSearch.requiresConnection)
    }

    func testOnlyWantedMoviesCanAutoSearch() {
        XCTAssertTrue(movieCanAutoSearch(type: "movie", status: "wanted"))
        XCTAssertTrue(movieCanAutoSearch(type: "movie", status: "missing"))
        XCTAssertFalse(movieCanAutoSearch(type: "movie", status: "downloaded"))
        XCTAssertFalse(movieCanAutoSearch(type: "movie", status: "downloading"))
        XCTAssertFalse(movieCanAutoSearch(type: "show", status: "wanted"))
    }

    func testReadAndPlayWorkOfflineInTheBookMenu() {
        let items = bookCardMenuItems(hasAudiobook: true, hasEbook: true, isAdmin: true, isRead: false)
        XCTAssertEqual(items.filter { !$0.requiresConnection }, [.read, .play])
        XCTAssertTrue(items.contains(.markRead))
        XCTAssertTrue(items.contains(.rescan))
    }

    func testResetProgressOnlyOffersWhenThereIsProgress() {
        let without = bookCardMenuItems(hasAudiobook: true, hasEbook: true, isAdmin: false, isRead: false)
        XCTAssertFalse(without.contains(.resetProgress))
        let with = bookCardMenuItems(
            hasAudiobook: true, hasEbook: true, isAdmin: false, isRead: false, hasProgress: true
        )
        XCTAssertTrue(with.contains(.resetProgress))
    }

    func testDownloadFollowsAudiobookAndDownloadedState() {
        let fresh = bookCardMenuItems(hasAudiobook: true, hasEbook: false, isAdmin: false, isRead: false)
        XCTAssertTrue(fresh.contains(.download))
        XCTAssertFalse(fresh.contains(.removeDownload))
        let saved = bookCardMenuItems(
            hasAudiobook: true, hasEbook: false, isAdmin: false, isRead: false, audiobookDownloaded: true
        )
        XCTAssertTrue(saved.contains(.removeDownload))
        XCTAssertFalse(saved.contains(.download))
        let ebookOnly = bookCardMenuItems(hasAudiobook: false, hasEbook: true, isAdmin: false, isRead: false)
        XCTAssertFalse(ebookOnly.contains(.download))
        XCTAssertFalse(ebookOnly.contains(.removeDownload))
    }
}
