@testable import RawkoonKit
import XCTest

private func position(
    editionId: Int = 10,
    spineIndex: Int,
    spinePath: String,
    spineCount: Int = 3,
    scrollFraction: Double = 0.5,
    updatedAtMillis: Int64 = 1000
) -> ReadingPosition {
    ReadingPosition(
        editionId: editionId,
        fileId: 64,
        spineIndex: spineIndex,
        spinePath: spinePath,
        spineCount: spineCount,
        scrollFraction: scrollFraction,
        updatedAtMillis: updatedAtMillis
    )
}

final class ReadingProgressReconcilerTests: XCTestCase {
    func testNewestWriteWins() {
        let local = position(spineIndex: 1, spinePath: "b.xhtml", updatedAtMillis: 2000)
        let remote = position(spineIndex: 2, spinePath: "c.xhtml", updatedAtMillis: 3000)

        XCTAssertEqual(ReadingProgressReconciler.reconcile(local: local, remote: remote), .takeRemote)
        XCTAssertEqual(ReadingProgressReconciler.reconcile(local: remote, remote: local), .push)
    }

    /// A tie must be stable, or two devices flip the position back and forth.
    func testTieKeepsLocal() {
        let local = position(spineIndex: 1, spinePath: "b.xhtml", updatedAtMillis: 2000)
        let remote = position(spineIndex: 2, spinePath: "c.xhtml", updatedAtMillis: 2000)

        XCTAssertEqual(ReadingProgressReconciler.reconcile(local: local, remote: remote), .keepLocal)
    }

    func testMissingSidesFallBackSensibly() {
        let some = position(spineIndex: 0, spinePath: "a.xhtml")

        XCTAssertEqual(ReadingProgressReconciler.reconcile(local: nil, remote: nil), .keepLocal)
        XCTAssertEqual(ReadingProgressReconciler.reconcile(local: nil, remote: some), .takeRemote)
        XCTAssertEqual(ReadingProgressReconciler.reconcile(local: some, remote: nil), .push)
    }
}

final class ReadingProgressResolveTests: XCTestCase {
    private let spine = ["a.xhtml", "b.xhtml", "c.xhtml"]

    func testKeepsTheIndexWhenThePathStillMatches() {
        let resolved = ReadingProgressReconciler.resolve(
            position(spineIndex: 1, spinePath: "b.xhtml", scrollFraction: 0.4),
            spine: spine
        )
        XCTAssertEqual(resolved.index, 1)
        XCTAssertEqual(resolved.scrollFraction, 0.4)
    }

    /// A re-download can insert a chapter. Following the path keeps the reader
    /// on the page they were on instead of shifting them a chapter back.
    func testFollowsThePathWhenTheSpineWasReordered() {
        let resolved = ReadingProgressReconciler.resolve(
            position(spineIndex: 0, spinePath: "c.xhtml", scrollFraction: 0.9),
            spine: spine
        )
        XCTAssertEqual(resolved.index, 2)
        XCTAssertEqual(resolved.scrollFraction, 0.9)
    }

    /// The path is gone, so the offset means nothing — land at the top of the
    /// nearest chapter rather than mid-way through an unrelated one.
    func testDropsTheOffsetWhenThePathIsGone() {
        let resolved = ReadingProgressReconciler.resolve(
            position(spineIndex: 9, spinePath: "removed.xhtml", scrollFraction: 0.8),
            spine: spine
        )
        XCTAssertEqual(resolved.index, 2)
        XCTAssertEqual(resolved.scrollFraction, 0)
    }

    func testHandlesAnEmptySpine() {
        let resolved = ReadingProgressReconciler.resolve(
            position(spineIndex: 4, spinePath: "a.xhtml"),
            spine: []
        )
        XCTAssertEqual(resolved.index, 0)
        XCTAssertEqual(resolved.scrollFraction, 0)
    }
}

final class ReadingProgressStoreTests: XCTestCase {
    private var directory: URL!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("reading-progress-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
    }

    func testRoundTripsPerEdition() throws {
        let store = ReadingProgressStore(directory: directory)
        XCTAssertNil(store.position(editionId: 10))

        try store.save(position(editionId: 10, spineIndex: 2, spinePath: "c.xhtml"))
        try store.save(position(editionId: 11, spineIndex: 0, spinePath: "a.xhtml"))

        XCTAssertEqual(store.position(editionId: 10)?.spinePath, "c.xhtml")
        XCTAssertEqual(store.position(editionId: 11)?.spineIndex, 0)

        // Saving the same edition again replaces rather than appends.
        try store.save(position(editionId: 10, spineIndex: 1, spinePath: "b.xhtml"))
        XCTAssertEqual(store.position(editionId: 10)?.spinePath, "b.xhtml")
        XCTAssertEqual(store.all().count, 2)

        try store.remove(editionId: 10)
        XCTAssertNil(store.position(editionId: 10))
        XCTAssertEqual(store.all().count, 1)
    }

    /// Losing a bookmark is recoverable; refusing to open the book is not.
    func testACorruptFileReadsAsEmptyRatherThanThrowing() throws {
        let store = ReadingProgressStore(directory: directory)
        try Data("{ not json".utf8).write(
            to: directory.appendingPathComponent("reading-progress.json")
        )

        XCTAssertEqual(store.all().count, 0)
        // And it recovers on the next write.
        try store.save(position(editionId: 10, spineIndex: 0, spinePath: "a.xhtml"))
        XCTAssertEqual(store.position(editionId: 10)?.spineIndex, 0)
    }

    func testScrollFractionIsClampedOnConstruction() {
        XCTAssertEqual(
            position(spineIndex: 0, spinePath: "a.xhtml", scrollFraction: 1.4).scrollFraction,
            1
        )
        XCTAssertEqual(
            position(spineIndex: 0, spinePath: "a.xhtml", scrollFraction: -0.2).scrollFraction,
            0
        )
    }

    func testLocatorRoundTripsAndDefaultsToNil() throws {
        let store = ReadingProgressStore(directory: directory)
        XCTAssertNil(position(spineIndex: 0, spinePath: "a.xhtml").locator)

        let json = "{\"href\":\"/ch1.xhtml\",\"type\":\"application/xhtml+xml\"}"
        try store.save(
            ReadingPosition(
                editionId: 10,
                fileId: 64,
                spineIndex: 0,
                spinePath: "a.xhtml",
                spineCount: 3,
                scrollFraction: 0.2,
                updatedAtMillis: 1000,
                locator: json
            )
        )
        XCTAssertEqual(store.position(editionId: 10)?.locator, json)
    }

    /// Positions written before the locator field must still load.
    func testMissingLocatorDecodesAsNil() throws {
        let payload = Data(
            """
            {"10":{"editionId":10,"fileId":64,"spineIndex":1,"spinePath":"b.xhtml","spineCount":3,"scrollFraction":0.5,"finished":false,"updatedAtMillis":1000}}
            """.utf8
        )
        try payload.write(to: directory.appendingPathComponent("reading-progress.json"))
        let store = ReadingProgressStore(directory: directory)
        XCTAssertNil(store.position(editionId: 10)?.locator)
        XCTAssertEqual(store.position(editionId: 10)?.spinePath, "b.xhtml")
    }
}
