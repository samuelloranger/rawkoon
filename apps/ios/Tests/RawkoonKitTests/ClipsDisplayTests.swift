@testable import RawkoonKit
import Testing

struct ClipsDisplayTests {
    @Test func movieHasNoSeasonSuffix() {
        #expect(ClipsDisplay.itemLabel(title: "A", seasonNumber: nil) == "A")
        #expect(ClipsDisplay.itemLabel(title: "A", seasonNumber: 0) == "A")
    }

    @Test func seasonGetsSuffix() {
        #expect(ClipsDisplay.itemLabel(title: "A", seasonNumber: 2) == "A · S2")
    }

    @Test func deleteAllNeedsClipsOffAndSomethingToDelete() {
        #expect(!ClipsDisplay.canDeleteAll(enabled: true, doneCount: 3, totalBytes: 10))
        #expect(!ClipsDisplay.canDeleteAll(enabled: false, doneCount: 0, totalBytes: 0))
        #expect(ClipsDisplay.canDeleteAll(enabled: false, doneCount: 3, totalBytes: 10))
    }
}
