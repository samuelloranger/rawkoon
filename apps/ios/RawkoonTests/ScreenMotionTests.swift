@testable import Rawkoon
import SwiftUI
import Testing

@MainActor
struct ScreenMotionTests {
    @Test func artworkRestsAtFullSizeWhilePlaying() {
        #expect(PlayerMotion.artworkScale(isPlaying: true, reduceMotion: false) == 1)
    }

    @Test func artworkSitsBackALittleWhenPaused() {
        let paused = PlayerMotion.artworkScale(isPlaying: false, reduceMotion: false)
        #expect(paused == PlayerMotion.pausedArtworkScale)
        #expect(paused < 1)
        #expect(paused >= 0.85)
    }

    @Test func artworkStaysStillUnderReduceMotion() {
        #expect(PlayerMotion.artworkScale(isPlaying: false, reduceMotion: true) == 1)
    }

    @Test func sleepRollKeysOnTheMode() {
        #expect(PlayerMotion.sleepRollValue(isOff: true, remaining: 300) == 0)
        #expect(PlayerMotion.sleepRollValue(isOff: false, remaining: nil) == -1)
    }

    @Test func sleepRollTicksOncePerDisplayedSecond() {
        #expect(PlayerMotion.sleepRollValue(isOff: false, remaining: 299.6) == 300)
        #expect(PlayerMotion.sleepRollValue(isOff: false, remaining: 299.4) == 299)
        #expect(PlayerMotion.sleepRollValue(isOff: false, remaining: 0.2) == 1)
    }
}
