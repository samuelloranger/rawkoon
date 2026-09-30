@testable import RawkoonKit
import Testing

struct FormattersTests {
    /// durationCompact — pure arithmetic, exact strings safe on Linux
    @Test func compactTruncatesAndDoesNotPad() {
        #expect(Formatters.durationCompact(2 * 3600 + 5 * 60) == "2h 5m") // unpadded
        #expect(Formatters.durationCompact(90) == "1m")
        #expect(Formatters.durationCompact(59) == "0m") // truncation
        #expect(Formatters.durationCompact(59.6) == "0m") // truncates — same input clock rounds up
    }

    @Test func compactRejectsInvalid() {
        #expect(Formatters.durationCompact(nil) == nil)
        #expect(Formatters.durationCompact(.nan) == nil)
        #expect(Formatters.durationCompact(.infinity) == nil)
        #expect(Formatters.durationCompact(-1) == nil)
    }

    /// durationClock — pure arithmetic, exact strings safe on Linux
    @Test func clockPadsAndRounds() {
        #expect(Formatters.durationClock(2 * 3600 + 5 * 60) == "2h 05m") // padded
        #expect(Formatters.durationClock(59.6) == "1m") // rounds up to a full minute
        #expect(Formatters.durationClock(0) == "0:00")
        #expect(Formatters.durationClock(.nan) == "0:00")
    }

    /// durationTimestamp — pure arithmetic, exact strings safe on Linux
    @Test func timestampUsesClockShapeAndFloors() {
        #expect(Formatters.durationTimestamp(3661) == "1:01:01")
        #expect(Formatters.durationTimestamp(125) == "2:05")
        #expect(Formatters.durationTimestamp(59) == "0:59")
        // Floors rather than rounds: the label must not name a point past where
        // playback actually starts.
        #expect(Formatters.durationTimestamp(59.9) == "0:59")
        #expect(Formatters.durationTimestamp(10 * 3600 + 9 * 60 + 8) == "10:09:08")
    }

    @Test func timestampFallsBackOnInvalid() {
        #expect(Formatters.durationTimestamp(0) == "0:00")
        #expect(Formatters.durationTimestamp(-1) == "0:00")
        #expect(Formatters.durationTimestamp(.nan) == "0:00")
        #expect(Formatters.durationTimestamp(.infinity) == "0:00")
    }

    /// bytes — assert BEHAVIOR only (ByteCountFormatter differs Linux vs Darwin)
    @Test func bytesEchoReturnsRawOnParseFailure() {
        #expect(Formatters.bytesEcho("not-a-number") == "not-a-number")
    }

    @Test func bytesStrictNilsOnNonPositiveOrNil() {
        #expect(Formatters.bytesStrict(nil) == nil)
        #expect(Formatters.bytesStrict("0") == nil)
        #expect(Formatters.bytesStrict("-5") == nil)
        #expect(Formatters.bytesStrict("1024") != nil) // non-nil; exact string is platform-dependent
    }

    /// speed — behavior only; non-finite must not trap
    @Test func speedIsSafeOnNonFinite() {
        #expect(Formatters.speed(.nan, useAll: true).hasSuffix("/s"))
        #expect(Formatters.speed(.infinity, useAll: false).hasSuffix("/s"))
    }

    @Test func listeningHoursZeroIs0h() {
        #expect(Formatters.listeningHours(0) == "0h")
    }

    @Test func listeningHoursSubMinuteIs0hNot0m() {
        #expect(Formatters.listeningHours(59) == "0h")
    }

    @Test func listeningHoursUnderAnHourIsMinutes() {
        #expect(Formatters.listeningHours(20 * 60) == "20m")
    }

    @Test func listeningHoursUnpadded() {
        #expect(Formatters.listeningHours(3 * 3600 + 20 * 60) == "3h 20m")
    }

    /// etaSeconds — seconds under a minute, then the same compact shape as file durations.
    @Test func etaShowsSecondsUnderAMinute() {
        #expect(Formatters.etaSeconds(0) == "0s")
        #expect(Formatters.etaSeconds(30) == "30s")
        #expect(Formatters.etaSeconds(59) == "59s")
    }

    @Test func etaUsesCompactPastAMinute() {
        #expect(Formatters.etaSeconds(61) == "1m")
        // Truncates, same as durationCompact — 90s is 1m, not a rounded 2m.
        #expect(Formatters.etaSeconds(90) == "1m")
        #expect(Formatters.etaSeconds(3600) == "1h 0m")
        #expect(Formatters.etaSeconds(2 * 3600 + 5 * 60) == "2h 5m")
    }

    @Test func etaRejectsInvalid() {
        #expect(Formatters.etaSeconds(nil) == nil)
        #expect(Formatters.etaSeconds(-1) == nil)
    }

    @Test func runtimeMinutesMatchesCompact() {
        #expect(Formatters.runtimeMinutes(45) == "45m")
        #expect(Formatters.runtimeMinutes(60) == "1h 0m")
        #expect(Formatters.runtimeMinutes(90) == "1h 30m")
        #expect(Formatters.runtimeMinutes(0) == nil)
        #expect(Formatters.runtimeMinutes(nil) == nil)
    }

    /// durationTimestampRounded — rounds, unlike durationTimestamp which floors.
    @Test func timestampRoundedRoundsUp() {
        #expect(Formatters.durationTimestampRounded(59.6) == "1:00")
        #expect(Formatters.durationTimestampRounded(3661) == "1:01:01")
        #expect(Formatters.durationTimestampRounded(125) == "2:05")
        #expect(Formatters.durationTimestampRounded(0) == "0:00")
        #expect(Formatters.durationTimestampRounded(.nan) == "0:00")
    }
}
