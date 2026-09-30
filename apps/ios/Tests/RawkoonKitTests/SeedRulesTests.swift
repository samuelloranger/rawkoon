@testable import RawkoonKit
import XCTest

final class SeedRulesTests: XCTestCase {
    func testParsesRatioLikeTheWebDraft() {
        XCTAssertEqual(SeedRuleLogic.parseRatio(""), .none)
        XCTAssertEqual(SeedRuleLogic.parseRatio("  "), .none)
        XCTAssertEqual(SeedRuleLogic.parseRatio("1.5"), .value(1.5))
        XCTAssertEqual(SeedRuleLogic.parseRatio("2,5"), .value(2.5))
        XCTAssertEqual(SeedRuleLogic.parseRatio("0"), .value(0))
        XCTAssertEqual(SeedRuleLogic.parseRatio("-1"), .invalid)
        XCTAssertEqual(SeedRuleLogic.parseRatio("abc"), .invalid)
        XCTAssertEqual(SeedRuleLogic.parseRatio("nan"), .invalid)
        XCTAssertEqual(SeedRuleLogic.parseRatio("inf"), .invalid)
    }

    func testAZeroTargetMeansNoTarget() {
        XCTAssertEqual(SeedRuleLogic.rule(ratio: .value(0)), SeedRule(ratio: nil))
        XCTAssertEqual(SeedRuleLogic.rule(ratio: .none), SeedRule(ratio: nil))
        XCTAssertNil(SeedRuleLogic.rule(ratio: .invalid))
        XCTAssertEqual(SeedRuleLogic.rule(ratio: .value(1.5)), SeedRule(ratio: 1.5))
    }

    func testSummaryCoversEveryCombination() {
        XCTAssertEqual(SeedRuleLogic.summary(SeedRule(ratio: nil)), .releaseOnImport)
        XCTAssertEqual(SeedRuleLogic.summary(SeedRule(ratio: 0, seedTimeMins: 0)), .releaseOnImport)
        XCTAssertEqual(SeedRuleLogic.summary(SeedRule(ratio: 2)), .ratio(2))
        XCTAssertEqual(SeedRuleLogic.summary(SeedRule(ratio: nil, seedTimeMins: 60)), .time(minutes: 60))
        XCTAssertEqual(
            SeedRuleLogic.summary(SeedRule(ratio: 1, seedTimeMins: 4320)),
            .ratioOrTime(1, minutes: 4320)
        )
    }

    func testDurationPrefersWholeDays() {
        XCTAssertEqual(SeedRuleLogic.duration(minutes: 4320).count, 3)
        XCTAssertTrue(SeedRuleLogic.duration(minutes: 4320).isDays)
        XCTAssertEqual(SeedRuleLogic.duration(minutes: 90).count, 1.5)
        XCTAssertFalse(SeedRuleLogic.duration(minutes: 90).isDays)
    }

    func testRatioTextRoundTrips() {
        XCTAssertEqual(SeedRuleLogic.ratioText(nil), "")
        XCTAssertEqual(SeedRuleLogic.ratioText(0), "")
        XCTAssertEqual(SeedRuleLogic.ratioText(1), "1")
        XCTAssertEqual(SeedRuleLogic.ratioText(1.5), "1.5")
        XCTAssertEqual(SeedRuleLogic.formatRatio(1), "1.0")
    }
}
