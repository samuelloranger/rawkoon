import Foundation
@testable import Rawkoon
import Testing

@MainActor
struct SSEDebugLogTests {
    private func entry(_ summary: String) -> SSEDebugLogEntry {
        SSEDebugLogEntry(timestamp: Date(), stream: "library", summary: summary)
    }

    @Test func prependsNewestFirst() {
        let log = appendSSELog([], entry: entry("a"), limit: 200)
        let log2 = appendSSELog(log, entry: entry("b"), limit: 200)
        #expect(log2.map(\.summary) == ["b", "a"])
    }

    @Test func capsAtTheLimitByDroppingTheOldest() {
        var log: [SSEDebugLogEntry] = []
        for i in 0 ..< 5 {
            log = appendSSELog(log, entry: entry("\(i)"), limit: 3)
        }
        #expect(log.map(\.summary) == ["4", "3", "2"])
    }

    @Test func neverExceedsTheLimitEvenFromAnOversizedStartingLog() {
        let oversized = (0 ..< 10).map { entry("\($0)") }
        let log = appendSSELog(oversized, entry: entry("new"), limit: 3)
        #expect(log.count == 3)
        #expect(log.first?.summary == "new")
    }
}
