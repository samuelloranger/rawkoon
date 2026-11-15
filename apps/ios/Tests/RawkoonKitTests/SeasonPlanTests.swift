@testable import RawkoonKit
import XCTest

final class SeasonPlanTests: XCTestCase {
    private let today = "2026-06-01"
    private let seasons = [
        SeasonInfo(number: 0, episodes: 3, airDate: "2019-01-01"),
        SeasonInfo(number: 1, episodes: 10, airDate: "2020-01-01"),
        SeasonInfo(number: 2, episodes: 8, airDate: "2021-01-01"),
        SeasonInfo(number: 3, episodes: 8, airDate: "2026-01-01"),
        SeasonInfo(number: 4, episodes: 6, airDate: "2027-01-01"),
        SeasonInfo(number: 5, episodes: 0, airDate: nil),
    ]

    private func monitored(_ mode: SeasonMode, picked: [Int] = []) -> Set<Int> {
        SeasonPlan.monitored(seasons, choice: SeasonChoice(mode: mode, picked: picked, monitorNew: true), today: today)
    }

    func testSpecialsNeverShow() {
        XCTAssertEqual(SeasonPlan.regular(seasons).map(\.number), [1, 2, 3, 4, 5])
    }

    func testAllMonitorsEveryRegularSeason() {
        XCTAssertEqual(monitored(.all), [1, 2, 3, 4, 5])
    }

    func testFutureLeavesAiredSeasonsAlone() {
        XCTAssertEqual(monitored(.future), [4, 5])
    }

    func testLatestIsTheNewestAiredSeasonPlusWhatIsAhead() {
        XCTAssertEqual(monitored(.latest), [3, 4, 5])
    }

    func testAnAnnouncedSeasonIsNeverLatest() {
        let announcedOnly = [SeasonInfo(number: 1, episodes: 8, airDate: "2020-01-01"),
                             SeasonInfo(number: 2, episodes: 0, airDate: "2025-01-01")]
        XCTAssertEqual(SeasonPlan.latestSeason(announcedOnly, today: today), 1)
    }

    func testPickKeepsOnlyKnownSeasons() {
        XCTAssertEqual(monitored(.pick, picked: [2, 9]), [2])
    }

    func testFutureForcesNewSeasonsOn() {
        XCTAssertTrue(SeasonChoice(mode: .future, monitorNew: false).monitorNew)
        XCTAssertFalse(SeasonChoice(mode: .all, monitorNew: false).monitorNew)
    }

    func testSeasonsPayloadOnlyWithPick() {
        XCTAssertNil(SeasonChoice(mode: .all, picked: [1], monitorNew: true).seasonsPayload)
        XCTAssertEqual(SeasonChoice(mode: .pick, picked: [3, 1], monitorNew: true).seasonsPayload, [1, 3])
    }

    func testSummaryCountsEpisodesAndRanges() {
        let summary = SeasonPlan.summary(
            seasons, choice: SeasonChoice(mode: .pick, picked: [1, 2, 4], monitorNew: false), today: today
        )
        XCTAssertEqual(summary.episodes, 24)
        XCTAssertEqual(summary.seasonList, "1\u{2013}2, 4")
        XCTAssertFalse(summary.monitorNew)
    }

    func testAnAnnouncedSeasonIsNotCounted() {
        let summary = SeasonPlan.summary(
            seasons, choice: SeasonChoice(mode: .all, monitorNew: true), today: today
        )
        XCTAssertEqual(summary.episodes, 32)
        XCTAssertEqual(summary.seasonList, "1\u{2013}4")
        XCTAssertEqual(SeasonPlan.released(seasons).count, 4)
        XCTAssertEqual(SeasonPlan.announced(seasons).map(\.number), [5])
    }

    func testFutureCountsOnlyEpisodesNotYetAired() {
        let midAir = [SeasonInfo(number: 1, episodes: 8, airDate: "2026-01-01", aired: 5)]
        let summary = SeasonPlan.summary(
            midAir, choice: SeasonChoice(mode: .future, monitorNew: true), today: today
        )
        XCTAssertEqual(summary.episodes, 3)
        XCTAssertEqual(
            SeasonPlan.litEpisodes(midAir[0], choice: SeasonChoice(mode: .future, monitorNew: true), latest: 1, today: today),
            [false, false, false, false, false, true, true, true]
        )
    }

    func testRanges() {
        XCTAssertEqual(SeasonPlan.ranges([1, 2, 3, 5]), "1\u{2013}3, 5")
        XCTAssertEqual(SeasonPlan.ranges([]), "")
    }

    func testRequestLabel() {
        XCTAssertEqual(RequestLabel.resolve(SeasonChoice(mode: .all, monitorNew: true)), .everything)
        XCTAssertEqual(RequestLabel.resolve(SeasonChoice(mode: .future, monitorNew: true)), .newEpisodes)
        XCTAssertEqual(RequestLabel.resolve(SeasonChoice(mode: .pick, picked: [2], monitorNew: true)), .season(2))
        XCTAssertEqual(RequestLabel.resolve(SeasonChoice(mode: .pick, picked: [1, 2], monitorNew: true)), .seasons(2))
    }

    func testDialogPolicy() {
        func needs(_ s: AddDialogPolicy.Subject, admin: Bool, ask: Bool = true, choose: Bool = true, movies: Int = 2) -> Bool {
            AddDialogPolicy.needsDialog(
                s, isAdmin: admin, askBeforeAdding: ask, requestersChooseSeasons: choose, movieProfileCount: movies
            )
        }
        XCTAssertTrue(needs(.show, admin: true))
        XCTAssertFalse(needs(.show, admin: true, ask: false))
        XCTAssertFalse(needs(.movie, admin: true, movies: 1))
        XCTAssertTrue(needs(.movie, admin: true))
        XCTAssertTrue(needs(.book, admin: true))
        XCTAssertTrue(needs(.show, admin: false))
        XCTAssertFalse(needs(.show, admin: false, choose: false))
        XCTAssertFalse(needs(.movie, admin: false))
        XCTAssertFalse(needs(.book, admin: false))
    }

    func testBookProfileFormatFilter() {
        XCTAssertTrue(AddDialogPolicy.bookProfileMatches(profileKind: "ebook", format: .ebook))
        XCTAssertFalse(AddDialogPolicy.bookProfileMatches(profileKind: "ebook", format: .audiobook))
        XCTAssertFalse(AddDialogPolicy.bookProfileMatches(profileKind: "ebook", format: .both))
        XCTAssertTrue(AddDialogPolicy.bookProfileMatches(profileKind: "both", format: .both))
        XCTAssertEqual(BookFormat.both.kinds, ["ebook", "audiobook"])
    }
}
