@testable import RawkoonKit
import XCTest

final class PlaybackRecoveryTests: XCTestCase {
    // MARK: Format sniffing

    /// The production change that would make these fail: a local chapter
    /// opened without a type hint. Chapters land as `<id>.bin`, and
    /// AVFoundation refuses to open a `.bin` it cannot place by extension.
    func testID3TaggedMP3IsMPEG() {
        XCTAssertEqual(sniffedAudioMIMEType(Data("ID3".utf8) + Data([3, 0, 0, 0])), "audio/mpeg")
    }

    func testUntaggedMP3FrameSyncIsMPEG() {
        XCTAssertEqual(sniffedAudioMIMEType(Data([0xFF, 0xFB, 0x90, 0x64])), "audio/mpeg")
    }

    func testISOBaseMediaIsMP4() {
        let header = Data([0, 0, 0, 0x1C]) + Data("ftypM4A ".utf8)
        XCTAssertEqual(sniffedAudioMIMEType(header), "audio/mp4")
    }

    func testOggIsOgg() {
        XCTAssertEqual(sniffedAudioMIMEType(Data("OggS".utf8) + Data([0, 2])), "audio/ogg")
    }

    func testFLACIsFLAC() {
        XCTAssertEqual(sniffedAudioMIMEType(Data("fLaC".utf8) + Data([0, 0])), "audio/flac")
    }

    func testWAVIsWAV() {
        let header = Data("RIFF".utf8) + Data([0, 0, 0, 0]) + Data("WAVE".utf8)
        XCTAssertEqual(sniffedAudioMIMEType(header), "audio/wav")
    }

    func testUnknownOrShortHeaderHasNoType() {
        XCTAssertNil(sniffedAudioMIMEType(Data()))
        XCTAssertNil(sniffedAudioMIMEType(Data([0x00, 0x01])))
        XCTAssertNil(sniffedAudioMIMEType(Data("<html>".utf8)))
    }

    // MARK: Failure decisions

    func testAFailingLocalFileStreamsInsteadOnce() {
        XCTAssertEqual(
            playbackFailureAction(isLocalFile: true, localAlreadyFailed: false, secondsSinceStreamRetry: nil, isOnline: true),
            .streamInstead
        )
    }

    func testALocalFileThatFailedBeforeIsNotRetriedLocally() {
        XCTAssertEqual(
            playbackFailureAction(isLocalFile: true, localAlreadyFailed: true, secondsSinceStreamRetry: nil, isOnline: true),
            .stop(.unreadable)
        )
    }

    /// An expired grant or a dropped signal: refresh the signed URL and retry.
    func testAFailingStreamRetriesWithFreshURLsWhileOnline() {
        XCTAssertEqual(
            playbackFailureAction(isLocalFile: false, localAlreadyFailed: false, secondsSinceStreamRetry: nil, isOnline: true),
            .refreshAndRetry
        )
    }

    func testAStreamThatJustFailedAfterARetryStops() {
        XCTAssertEqual(
            playbackFailureAction(isLocalFile: false, localAlreadyFailed: false, secondsSinceStreamRetry: 5, isOnline: true),
            .stop(.streamFailed)
        )
    }

    /// A later blip on the same chapter, long after the last retry succeeded,
    /// earns another retry rather than stopping the drive.
    func testAnOldRetryDoesNotBlockANewOne() {
        XCTAssertEqual(
            playbackFailureAction(isLocalFile: false, localAlreadyFailed: false, secondsSinceStreamRetry: 600, isOnline: true),
            .refreshAndRetry
        )
    }

    func testAFailingStreamWhileOfflineStopsAndSaysSo() {
        XCTAssertEqual(
            playbackFailureAction(isLocalFile: false, localAlreadyFailed: false, secondsSinceStreamRetry: nil, isOnline: false),
            .stop(.offline)
        )
    }
}
