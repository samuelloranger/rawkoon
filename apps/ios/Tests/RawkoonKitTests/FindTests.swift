@testable import RawkoonKit
import XCTest

final class FindTests: XCTestCase {
    func testShelvesListWatchlistCollectionsShelvesThenBestsellers() {
        XCTAssertEqual(FindShelf.visible(booksEnabled: true), [.watchlist, .collections, .shelves, .bestsellers])
    }

    func testBestsellersShelfHidesWithBooksDisabled() {
        XCTAssertEqual(FindShelf.visible(booksEnabled: false), [.watchlist, .collections, .shelves])
    }

    func testResultGroupsPutLibraryFirst() {
        XCTAssertEqual(FindResultGroup.visible(booksEnabled: true), [.library, .titles, .books])
    }

    func testBooksGroupHidesWithBooksDisabled() {
        XCTAssertEqual(FindResultGroup.visible(booksEnabled: false), [.library, .titles])
    }

    func testSearchNeedsTwoCharacters() {
        XCTAssertFalse(FindSearch.isActive(""))
        XCTAssertFalse(FindSearch.isActive(" a "))
        XCTAssertTrue(FindSearch.isActive("ab"))
        XCTAssertTrue(FindSearch.isActive("  ab  "))
    }

    func testHideOwnedDropsOnlyOwnedItems() {
        let items = [(1, true), (2, false), (3, true), (4, false)]
        XCTAssertEqual(FindSearch.visible(items, hideOwned: true, isOwned: { $0.1 }).map(\.0), [2, 4])
        XCTAssertEqual(FindSearch.visible(items, hideOwned: false, isOwned: { $0.1 }).map(\.0), [1, 2, 3, 4])
    }

    func testModesAreBrowseThenSwipe() {
        XCTAssertEqual(FindMode.allCases, [.browse, .swipe])
        XCTAssertEqual(FindMode(rawValue: "browse"), .browse)
    }
}
