@testable import Rawkoon
import SwiftUI
import Testing

@MainActor
struct RawkoonMotionTests {
    @Test func staggerGrowsThenClamps() {
        #expect(RawkoonMotion.staggerDelay(position: 0) == 0)
        #expect(RawkoonMotion.staggerDelay(position: 1) == 0.04)
        #expect(RawkoonMotion.staggerDelay(position: 8) == 0.32)
        #expect(RawkoonMotion.staggerDelay(position: 200) == 0.32)
        #expect(RawkoonMotion.staggerDelay(position: -3) == 0)
    }

    @Test func ledgerClaimsOncePerId() {
        let ledger = EntranceLedger()
        #expect(ledger.isPending("a"))
        #expect(ledger.claim("a", now: 0) == 0)
        #expect(!ledger.isPending("a"))
        #expect(ledger.claim("a", now: 0.01) == nil)
    }

    @Test func ledgerStaggersWithinABurst() {
        let ledger = EntranceLedger()
        #expect(ledger.claim("a", now: 10.00) == 0)
        #expect(ledger.claim("b", now: 10.01) == 1)
        #expect(ledger.claim("c", now: 10.02) == 2)
    }

    @Test func ledgerResetsBurstAfterAGap() {
        let ledger = EntranceLedger()
        _ = ledger.claim("a", now: 10.00)
        _ = ledger.claim("b", now: 10.01)
        #expect(ledger.claim("c", now: 10.00 + EntranceLedger.burstWindow + 0.01) == 0)
    }

    @Test func ledgerStaysQuickDuringContinuousScroll() {
        let ledger = EntranceLedger()
        var worst = 0
        for step in 0 ..< 40 {
            let position = ledger.claim(step, now: 100 + Double(step) * 0.05) ?? 0
            worst = max(worst, position)
        }
        #expect(worst <= 4)
    }

    @Test func ledgerDistinguishesIdTypes() {
        let ledger = EntranceLedger()
        #expect(ledger.claim(AnyHashable(1), now: 0) == 0)
        #expect(ledger.claim(AnyHashable("1"), now: 0) == 1)
    }

    @Test func heroAtRestIsIdentity() {
        let transform = HeroStretch.transform(minY: 0, height: 260)
        #expect(transform == .init(scale: 1, offsetY: 0, opacity: 1))
    }

    @Test func heroPulledDownStretchesFromBottom() {
        let transform = HeroStretch.transform(minY: 130, height: 260)
        #expect(transform.scale == 1.5)
        #expect(transform.offsetY == 0)
        #expect(transform.opacity == 1)
    }

    @Test func heroScrolledUpParallaxesAndFades() {
        let transform = HeroStretch.transform(minY: -130, height: 260)
        #expect(transform.scale == 1)
        #expect(transform.offsetY == 65)
        #expect(abs(transform.opacity - 0.7) < 0.0001)
    }

    @Test func heroOpacityFloorsFarPastTheHero() {
        let transform = HeroStretch.transform(minY: -5000, height: 260)
        #expect(abs(transform.opacity - 0.4) < 0.0001)
    }

    @Test func heroZeroHeightIsIdentity() {
        #expect(HeroStretch.transform(minY: 50, height: 0) == .init(scale: 1, offsetY: 0, opacity: 1))
    }

    @Test func celebrationFiresOnAnyChangeWithoutAPredicate() {
        #expect(CelebrationGate.fires(from: false, to: true, when: nil))
        #expect(CelebrationGate.fires(from: true, to: false, when: nil))
        #expect(CelebrationGate.fires(from: 1, to: 2, when: nil))
    }

    @Test func celebrationIgnoresANonChange() {
        #expect(!CelebrationGate.fires(from: 3, to: 3, when: nil))
        #expect(!CelebrationGate.fires(from: true, to: true) { _, _ in true })
    }

    @Test func celebrationPredicateBlocksAReversal() {
        let forwardOnly: (Bool, Bool) -> Bool = { old, new in !old && new }
        #expect(CelebrationGate.fires(from: false, to: true, when: forwardOnly))
        #expect(!CelebrationGate.fires(from: true, to: false, when: forwardOnly))
    }

    @Test func zoomSourceKeyKeepsTheActiveTabsId() {
        #expect(ZoomSourceKey.id("movie:42", inActiveTab: true) == "movie:42")
    }

    @Test func zoomSourceKeySeparatesBackgroundTabs() {
        let hidden = ZoomSourceKey.id("movie:42", inActiveTab: false)
        #expect(hidden != "movie:42")
        #expect(hidden == ZoomSourceKey.id("movie:42", inActiveTab: false))
        #expect(hidden != ZoomSourceKey.id("tv:42", inActiveTab: false))
    }
}
