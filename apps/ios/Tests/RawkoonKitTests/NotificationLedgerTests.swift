@testable import RawkoonKit
import XCTest

final class NotificationLedgerDayTests: XCTestCase {
    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Toronto")!
        return calendar
    }

    private func date(_ day: Int, _ hour: Int) -> Date {
        calendar.date(from: DateComponents(year: 2026, month: 10, day: day, hour: hour))!
    }

    func testBucketsByCalendarDayNotElapsedHours() {
        let now = date(28, 7)
        XCTAssertEqual(NotificationLedger.day(for: date(28, 0), now: now, calendar: calendar), .today)
        // Eight hours ago, but before midnight: yesterday.
        XCTAssertEqual(NotificationLedger.day(for: date(27, 23), now: now, calendar: calendar), .yesterday)
        XCTAssertEqual(
            NotificationLedger.day(for: date(26, 12), now: now, calendar: calendar),
            .thisWeek(calendar.startOfDay(for: date(26, 12)))
        )
        XCTAssertEqual(
            NotificationLedger.day(for: date(20, 12), now: now, calendar: calendar),
            .older(calendar.startOfDay(for: date(20, 12)))
        )
    }

    func testFutureDatesCountAsToday() {
        XCTAssertEqual(NotificationLedger.day(for: date(29, 1), now: date(28, 7), calendar: calendar), .today)
    }

    func testSectionsKeepOrderAndSplitOnDayChange() {
        let items: [(String, Date?)] = [
            ("a", date(28, 6)), ("b", date(28, 1)), ("c", date(27, 20)), ("d", nil), ("e", date(26, 9)),
        ]
        let sections = NotificationLedger.sections(items, date: \.1, now: date(28, 7), calendar: calendar)
        XCTAssertEqual(sections.map(\.day), [.today, .yesterday, .thisWeek(calendar.startOfDay(for: date(26, 9)))])
        XCTAssertEqual(sections.map { $0.items.map(\.0) }, [["a", "b"], ["c", "d"], ["e"]])
    }

    func testEmptyListHasNoSections() {
        let items: [Date] = []
        XCTAssertTrue(NotificationLedger.sections(items, date: { $0 }, now: date(28, 7)).isEmpty)
    }
}

final class NotificationLedgerReleaseTests: XCTestCase {
    func testSummarizesAnEpisodeRelease() {
        XCTAssertEqual(
            NotificationLedger.releaseSummary("Show.S01E06.MULTi.VFF.2160p.DV.H-DR.WEB.EAC3.5.1.H265-GRP"),
            "MULTi VFF 2160p DV WEB · GRP"
        )
    }

    func testReadsASourceGluedToADash() {
        XCTAssertEqual(
            NotificationLedger.releaseSummary("Show.S01E04.AD.VFQ.1080p.-WEB.AC3.5.1.H265-GRP"),
            "VFQ 1080p WEB · GRP"
        )
    }

    func testPrefersDolbyVisionOverHDR10Plus() {
        XCTAssertEqual(
            NotificationLedger.releaseSummary("Film.2026.MULTI.VF2.2160p.WEB.DV.HDR10Plus.EAC3.5.1.H265-GRP"),
            "MULTi VF2 2160p DV WEB · GRP"
        )
    }

    func testWebDLIsASourceNotAGroup() {
        XCTAssertEqual(NotificationLedger.releaseSummary("Film 2024 1080p WEB-DL"), "1080p WEB")
    }

    func testDropsAGroupCutOffByTruncation() {
        XCTAssertEqual(NotificationLedger.releaseSummary("Film.2024.1080p.BluRay.x264-GRO…"), "1080p BluRay")
    }

    func testIgnoresTitleWordsBeforeTheYear() {
        XCTAssertEqual(
            NotificationLedger.releaseSummary("Charlottes.Web.2006.1080p.BluRay.x264-GRP"),
            "1080p BluRay · GRP"
        )
        XCTAssertEqual(
            NotificationLedger.releaseSummary("The.French.Dispatch.2021.1080p.WEB-DL-GRP"),
            "1080p WEB · GRP"
        )
    }

    func testNilForANameThatIsNotASceneName() {
        XCTAssertNil(NotificationLedger.releaseSummary("Spider-Man"))
        XCTAssertNil(NotificationLedger.releaseSummary("Some Book - Audiobook"))
    }

    func testNilWhenNothingIsRecognised() {
        XCTAssertNil(NotificationLedger.releaseSummary("Some Audiobook Title"))
    }
}

final class NotificationLedgerVersionTests: XCTestCase {
    func testHidesTheUpdateNoticeForAnAnnouncedVersion() {
        let notices = [
            NotificationLedger.VersionNotice(id: 1, installed: nil, announced: ["v1.46.0"]),
            NotificationLedger.VersionNotice(id: 2, installed: "1.46.0", announced: []),
            NotificationLedger.VersionNotice(id: 3, installed: "v1.45.0", announced: []),
        ]
        XCTAssertEqual(NotificationLedger.hiddenUpdateNotices(notices), [2])
    }

    func testKeepsUpdateNoticesWithNoMatchingRelease() {
        let notices = [NotificationLedger.VersionNotice(id: 2, installed: "v1.46.0", announced: [])]
        XCTAssertTrue(NotificationLedger.hiddenUpdateNotices(notices).isEmpty)
    }
}

final class NotificationLedgerDateTests: XCTestCase {
    func testParsesWithAndWithoutFractionalSeconds() {
        XCTAssertNotNil(NotificationLedger.parseDate("2026-10-28T07:04:00.123Z"))
        XCTAssertNotNil(NotificationLedger.parseDate("2026-10-28T07:04:00Z"))
        XCTAssertNil(NotificationLedger.parseDate("yesterday"))
    }
}

final class NotificationLedgerLegacyTests: XCTestCase {
    func testReadsAQuotedEpisodeName() {
        XCTAssertEqual(
            NotificationLedger.legacySubject(
                title: "S01E06 téléchargé",
                body: "Show (2026) — S01E06 « Deadlock » est dans votre bibliothèque."
            ),
            .init(title: "Show", code: "S01E06", detail: "Deadlock")
        )
    }

    func testKeepsTheReleaseNameOfAGrab() {
        XCTAssertEqual(
            NotificationLedger.legacySubject(title: "S01E05 grabbed", body: "Show (2026) — Show.S01E05.1080p.WEB-GRP"),
            .init(title: "Show", code: "S01E05", detail: "Show.S01E05.1080p.WEB-GRP")
        )
    }

    func testDropsATailThatOnlyRepeatsTheCode() {
        XCTAssertEqual(
            NotificationLedger.legacySubject(
                title: "S01E04 downloaded", body: "Show (2026) — S01E04 is now in your library."
            ),
            .init(title: "Show", code: "S01E04", detail: nil)
        )
    }

    func testReadsAMovieSentence() {
        XCTAssertEqual(
            NotificationLedger.legacySubject(title: "Movie downloaded", body: "Film (2022) is now in your library."),
            .init(title: "Film", code: nil, detail: nil)
        )
    }

    func testNilWithoutALeadingTitleAndYear() {
        XCTAssertNil(NotificationLedger.legacySubject(title: "App updated", body: "Rawkoon was updated to v1.46.0."))
    }

    func testStripsATrailingYearOnly() {
        XCTAssertEqual(NotificationLedger.strippingYear("Show (2026)"), "Show")
        XCTAssertEqual(NotificationLedger.strippingYear("1917"), "1917")
        XCTAssertEqual(NotificationLedger.strippingYear("Blade Runner 2049"), "Blade Runner 2049")
    }
}
