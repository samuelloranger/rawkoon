import Foundation
@testable import RawkoonKit
import Testing

/// The shelf rules the editor depends on: moving a row, and reading a yearly
/// window the way the server does.
struct ShelvesTests {
    // MARK: - Moving rows

    @Test func movingARowDownLandsAfterTheTarget() {
        #expect(ShelfMove.move(["a", "b", "c"], from: IndexSet(integer: 0), to: 2) == ["b", "a", "c"])
        #expect(ShelfMove.move(["a", "b", "c"], from: IndexSet(integer: 0), to: 3) == ["b", "c", "a"])
    }

    @Test func movingARowUpLandsBeforeTheTarget() {
        #expect(ShelfMove.move(["a", "b", "c"], from: IndexSet(integer: 2), to: 0) == ["c", "a", "b"])
        #expect(ShelfMove.move(["a", "b", "c"], from: IndexSet(integer: 2), to: 1) == ["a", "c", "b"])
    }

    @Test func movingSeveralRowsKeepsTheirOrder() {
        #expect(ShelfMove.move(["a", "b", "c", "d"], from: IndexSet([0, 1]), to: 4) == ["c", "d", "a", "b"])
        #expect(ShelfMove.move(["a", "b", "c", "d"], from: IndexSet([2, 3]), to: 0) == ["c", "d", "a", "b"])
    }

    @Test func movingNowhereChangesNothing() {
        #expect(ShelfMove.move(["a", "b"], from: IndexSet(integer: 1), to: 1) == ["a", "b"])
        #expect(ShelfMove.move([Int](), from: IndexSet(), to: 0) == [])
    }

    // MARK: - The yearly window

    @Test func aMonthDayReadsTheServersShape() {
        #expect(MonthDay("11-01") == MonthDay(month: 11, day: 1))
        #expect(MonthDay("01-15")?.raw == "01-15")
        #expect(MonthDay("02-29") != nil)
        #expect(MonthDay("02-30") == nil)
        #expect(MonthDay("02-31") == nil)
        #expect(MonthDay("04-31") == nil)
        #expect(MonthDay("13-01") == nil)
        #expect(MonthDay("00-10") == nil)
        #expect(MonthDay("1-1") == nil)
        #expect(MonthDay(nil) == nil)
    }

    @Test func aWindowWrapsTheYearEndAndIncludesBothEnds() {
        let from = MonthDay("11-01")
        let until = MonthDay("01-15")
        func visible(_ month: Int, _ day: Int) -> Bool {
            MonthDay.isWithin(from: from, to: until, date: date(month, day))
        }
        #expect(visible(11, 1))
        #expect(visible(12, 31))
        #expect(visible(1, 1))
        #expect(visible(1, 15))
        #expect(!visible(10, 31))
        #expect(!visible(1, 16))
    }

    @Test func aWindowInsideOneYearAndOneSidedBounds() {
        let from = MonthDay("03-01")
        let until = MonthDay("06-30")
        #expect(MonthDay.isWithin(from: from, to: until, date: date(3, 1)))
        #expect(MonthDay.isWithin(from: from, to: until, date: date(6, 30)))
        #expect(!MonthDay.isWithin(from: from, to: until, date: date(7, 1)))
        #expect(MonthDay.isWithin(from: from, to: nil, date: date(12, 1)))
        #expect(!MonthDay.isWithin(from: from, to: nil, date: date(2, 28)))
        #expect(MonthDay.isWithin(from: nil, to: until, date: date(1, 1)))
        #expect(!MonthDay.isWithin(from: nil, to: until, date: date(7, 1)))
        #expect(MonthDay.isWithin(from: nil, to: nil, date: date(7, 1)))
    }

    // MARK: - Order modes

    @Test func anUnknownOrderModeReadsAsByHand() {
        #expect(ShelfOrderMode(serverValue: "release") == .release)
        #expect(ShelfOrderMode(serverValue: "added") == .added)
        #expect(ShelfOrderMode(serverValue: "sideways") == .manual)
        #expect(ShelfOrderMode(serverValue: nil) == .manual)
    }

    private func date(_ month: Int, _ day: Int) -> Date {
        var components = DateComponents()
        components.year = 2026
        components.month = month
        components.day = day
        components.hour = 12
        return Calendar.current.date(from: components) ?? Date()
    }
}
