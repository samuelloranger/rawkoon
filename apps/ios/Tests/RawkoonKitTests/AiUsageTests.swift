@testable import RawkoonKit
import Testing

struct AiUsageTests {
    @Test func costKeepsTinySpendVisible() {
        #expect(AiUsage.cost(nil) == "\u{2014}")
        #expect(AiUsage.cost(0) == "$0.00")
        #expect(AiUsage.cost(0.0042) == "$0.0042")
        #expect(AiUsage.cost(1.5) == "$1.50")
    }

    @Test func tokensAreCompact() {
        #expect(AiUsage.tokens(nil) == "\u{2014}")
        #expect(AiUsage.tokens(950) == "950")
        #expect(AiUsage.tokens(1200) == "1.2K")
        #expect(AiUsage.tokens(3_000_000) == "3M")
        #expect(AiUsage.tokens(1_100_000_000) == "1.1B")
    }

    @Test func millisecondsSwitchToSeconds() {
        #expect(AiUsage.milliseconds(nil) == "\u{2014}")
        #expect(AiUsage.milliseconds(420.4) == "420 ms")
        #expect(AiUsage.milliseconds(1500) == "1.5 s")
    }

    @Test func percentDropsTrailingZero() {
        #expect(AiUsage.percent(0.874) == "87.4%")
        #expect(AiUsage.percent(1) == "100%")
        #expect(AiUsage.percent(0) == "0%")
        #expect(AiUsage.changedShare(agreementRate: nil) == nil)
        #expect(AiUsage.changedShare(agreementRate: 0.75) == 0.25)
    }

    @Test func blankOrInvalidPriceClears() {
        #expect(AiUsage.parsePrice("") == nil)
        #expect(AiUsage.parsePrice("  ") == nil)
        #expect(AiUsage.parsePrice("abc") == nil)
        #expect(AiUsage.parsePrice("-1") == nil)
        #expect(AiUsage.parsePrice("0.15") == 0.15)
        #expect(AiUsage.parsePrice("0,6") == 0.6)
        #expect(AiUsage.parsePrice("0") == 0)
    }

    @Test func priceTextRoundTrips() {
        #expect(AiUsage.priceText(nil) == "")
        #expect(AiUsage.priceText(2) == "2")
        #expect(AiUsage.priceText(0.15) == "0.15")
    }

    @Test func budgetNeedsAtLeastOnePrice() {
        #expect(AiUsage.budgetNeedsPrices(budget: 1, inputPrice: nil, outputPrice: nil))
        #expect(!AiUsage.budgetNeedsPrices(budget: 1, inputPrice: 0.1, outputPrice: nil))
        #expect(!AiUsage.budgetNeedsPrices(budget: nil, inputPrice: nil, outputPrice: nil))
    }

    @Test func todayTileState() {
        #expect(AiUsage.budgetReached(spend: 2, budget: 2, pricesConfigured: true))
        #expect(!AiUsage.budgetReached(spend: 1, budget: 2, pricesConfigured: true))
        #expect(!AiUsage.budgetReached(spend: 3, budget: 2, pricesConfigured: false))
        #expect(AiUsage.budgetRatio(spend: 5, budget: 2) == 1)
        #expect(AiUsage.budgetRatio(spend: 0.5, budget: 2) == 0.25)
        #expect(AiUsage.budgetRatio(spend: nil, budget: 2) == 0)
        #expect(AiUsage.budgetRatio(spend: 1, budget: 0) == 0)
    }

    @Test func failureRateNeedsSettledGrabs() {
        #expect(AiUsage.failureRate(completed: 0, failed: 0) == nil)
        #expect(AiUsage.failureRate(completed: 3, failed: 1) == 0.25)
    }

    @Test func chartMaxHasFloor() {
        #expect(AiUsage.chartMax([]) == 1)
        #expect(AiUsage.chartMax([0, 0]) == 1)
        #expect(AiUsage.chartMax([3, 12, 7]) == 12)
        #expect(AiUsage.chartMax([0.002, 0.05, 0.01]) == 0.05)
    }

    @Test func pickFailureMapping() {
        #expect(AiPickFailure.from(status: 404) == .featureOff)
        #expect(AiPickFailure.from(status: 429) == .budgetReached)
        #expect(AiPickFailure.from(status: 500) == .failed)
        #expect(AiPickFailure.from(status: nil) == .failed)
    }
}
