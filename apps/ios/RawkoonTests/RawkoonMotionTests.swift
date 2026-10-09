@testable import Rawkoon
import SwiftUI
import Testing

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
        #expect(ledger.claim("c", now: 10.01 + EntranceLedger.burstGap + 0.01) == 0)
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
}
