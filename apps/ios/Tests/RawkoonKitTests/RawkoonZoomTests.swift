@testable import RawkoonKit
import XCTest

final class RawkoonZoomTests: XCTestCase {
    func testKindsArePrefixedAndDistinct() {
        XCTAssertEqual(RawkoonZoom.media(tmdbId: 5, mediaType: "movie"), "movie:5")
        XCTAssertEqual(RawkoonZoom.media(tmdbId: 5, mediaType: "tv"), "tv:5")
        XCTAssertEqual(RawkoonZoom.book(5), "book:5")
        XCTAssertEqual(RawkoonZoom.audiobook(editionId: 5), "audiobook:5")
    }

    func testNoCollisionAcrossSpaces() {
        let ids = Set([
            RawkoonZoom.media(tmdbId: 5, mediaType: "movie"),
            RawkoonZoom.media(tmdbId: 5, mediaType: "tv"),
            RawkoonZoom.book(5),
            RawkoonZoom.audiobook(editionId: 5),
        ])
        XCTAssertEqual(ids.count, 4)
    }
}
