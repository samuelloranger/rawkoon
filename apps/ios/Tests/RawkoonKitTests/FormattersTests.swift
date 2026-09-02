import Testing
@testable import RawkoonKit

struct FormattersTests {
    // durationCompact — pure arithmetic, exact strings safe on Linux
    @Test func compactTruncatesAndDoesNotPad() {
        #expect(Formatters.durationCompact(2 * 3600 + 5 * 60) == "2h 5m")   // unpadded
        #expect(Formatters.durationCompact(90) == "1m")
        #expect(Formatters.durationCompact(59) == "0m")                     // truncation
        #expect(Formatters.durationCompact(59.6) == "0m")                   // truncates — same input clock rounds up
    }
    @Test func compactRejectsInvalid() {
        #expect(Formatters.durationCompact(nil) == nil)
        #expect(Formatters.durationCompact(.nan) == nil)
        #expect(Formatters.durationCompact(.infinity) == nil)
        #expect(Formatters.durationCompact(-1) == nil)
    }
    // durationClock — pure arithmetic, exact strings safe on Linux
    @Test func clockPadsAndRounds() {
        #expect(Formatters.durationClock(2 * 3600 + 5 * 60) == "2h 05m")    // padded
        #expect(Formatters.durationClock(59.6) == "1m")                     // rounds up to a full minute
        #expect(Formatters.durationClock(0) == "0:00")
        #expect(Formatters.durationClock(.nan) == "0:00")
    }
    // bytes — assert BEHAVIOR only (ByteCountFormatter differs Linux vs Darwin)
    @Test func bytesEchoReturnsRawOnParseFailure() {
        #expect(Formatters.bytesEcho("not-a-number") == "not-a-number")
    }
    @Test func bytesStrictNilsOnNonPositiveOrNil() {
        #expect(Formatters.bytesStrict(nil) == nil)
        #expect(Formatters.bytesStrict("0") == nil)
        #expect(Formatters.bytesStrict("-5") == nil)
        #expect(Formatters.bytesStrict("1024") != nil)   // non-nil; exact string is platform-dependent
    }
    // speed — behavior only; non-finite must not trap
    @Test func speedIsSafeOnNonFinite() {
        #expect(Formatters.speed(.nan, useAll: true).hasSuffix("/s"))
        #expect(Formatters.speed(.infinity, useAll: false).hasSuffix("/s"))
    }
}
