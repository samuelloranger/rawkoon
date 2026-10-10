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

    @Test func scopedZoomIdsDifferByContextAndRepeatWithinOne() {
        let base = "movie:42"
        #expect(ZoomSourceKey.scoped(base, in: "watchlist") == ZoomSourceKey.scoped(base, in: "watchlist"))
        #expect(ZoomSourceKey.scoped(base, in: "watchlist") != ZoomSourceKey.scoped(base, in: "similar:movie:7"))
        #expect(ZoomSourceKey.scoped(base, in: "watchlist") != base)
    }

    @Test func heroPullIsZeroAtRestWhateverTheTopInset() {
        #expect(HeroStretch.pull(contentOffsetY: -103, insetTop: 103) == 0)
        #expect(HeroStretch.pull(contentOffsetY: 0, insetTop: 0) == 0)
    }

    @Test func heroPullGrowsWhileOverscrolled() {
        #expect(HeroStretch.pull(contentOffsetY: -143, insetTop: 103) == 40)
    }

    @Test func heroPullGoesNegativeWhenScrolledUp() {
        #expect(HeroStretch.pull(contentOffsetY: 97, insetTop: 103) == -200)
    }

    @Test func heroPullClampsOnceTheHeroIsGone() {
        #expect(HeroStretch.pull(contentOffsetY: 5000, insetTop: 103) == -HeroStretch.trackedDepth)
        #expect(HeroStretch.trackedDepth >= 260)
    }

    @Test func heroAtRestPullIsIdentity() {
        let pull = HeroStretch.pull(contentOffsetY: -103, insetTop: 103)
        #expect(HeroStretch.transform(minY: pull, height: 260) == .init(scale: 1, offsetY: 0, opacity: 1))
    }

    @Test func slideEntersFromTheTappedSide() {
        #expect(RawkoonSlide.edge(from: 0, to: 2) == .trailing)
        #expect(RawkoonSlide.edge(from: 2, to: 1) == .leading)
        #expect(RawkoonSlide.edge(from: 1, to: 1) == .trailing)
    }

    @Test func slideOffsetsOnlyTheEnteringView() {
        let distance = RawkoonSlide.distance
        let trailing = RawkoonSlide.offset(edge: .trailing, appearing: true, reduceMotion: false)
        let leading = RawkoonSlide.offset(edge: .leading, appearing: true, reduceMotion: false)
        let bottom = RawkoonSlide.offset(edge: .bottom, appearing: true, reduceMotion: false)
        #expect(trailing == CGSize(width: distance, height: 0))
        #expect(leading == CGSize(width: -distance, height: 0))
        #expect(bottom == CGSize(width: 0, height: distance))
        #expect(RawkoonSlide.offset(edge: .trailing, appearing: false, reduceMotion: false) == .zero)
    }

    @Test func slideStaysPutUnderReduceMotion() {
        #expect(RawkoonSlide.offset(edge: .leading, appearing: true, reduceMotion: true) == .zero)
    }

    @Test func shakeEndsAtRest() {
        #expect(RawkoonShake.offsets.count == 5)
        #expect(RawkoonShake.offsets.last == 0)
    }

    @Test func shakeDecays() {
        let swings = RawkoonShake.offsets.dropLast().map(abs)
        #expect(zip(swings, swings.dropFirst()).allSatisfy { $0 > $1 })
        #expect((swings.max() ?? 0) <= 12)
    }

    @Test func shakeStaysShort() {
        #expect(Double(RawkoonShake.offsets.count) * RawkoonShake.beat <= 0.45)
    }

    @Test func popStartsSmallAndRestsAtFullSize() {
        #expect(RawkoonPop.scale(isIdentity: false, reduceMotion: false) == RawkoonPop.hiddenScale)
        #expect(RawkoonPop.hiddenScale < 1)
        #expect(RawkoonPop.scale(isIdentity: true, reduceMotion: false) == 1)
    }

    @Test func popOnlyFadesUnderReduceMotion() {
        #expect(RawkoonPop.scale(isIdentity: false, reduceMotion: true) == 1)
    }

    @Test func pressableRestsOpaqueAndDimsWhilePressed() {
        #expect(PressableAppearance.opacity(isPressed: false, isEnabled: true, dimHandledAbove: false) == 1)
        #expect(
            PressableAppearance.opacity(isPressed: true, isEnabled: true, dimHandledAbove: false)
                == PressableAppearance.pressedOpacity
        )
    }

    @Test func pressableDimsADisabledControl() {
        #expect(
            PressableAppearance.opacity(isPressed: false, isEnabled: false, dimHandledAbove: false)
                == PressableAppearance.disabledOpacity
        )
        #expect(PressableAppearance.disabledOpacity < PressableAppearance.pressedOpacity)
    }

    @Test func pressableLeavesAnAncestorsDimAlone() {
        #expect(PressableAppearance.opacity(isPressed: false, isEnabled: false, dimHandledAbove: true) == 1)
    }

    @Test func pressableIgnoresAPressWhileDisabled() {
        #expect(
            PressableAppearance.opacity(isPressed: true, isEnabled: false, dimHandledAbove: false)
                == PressableAppearance.disabledOpacity
        )
    }
}
