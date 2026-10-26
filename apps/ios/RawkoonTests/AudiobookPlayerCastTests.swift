import Foundation
@testable import Rawkoon
import RawkoonKit
import Testing

@MainActor
private final class RecordingRoute: AudiobookCastRoute {
    var calls: [String] = []

    func load(at wholeBookPosition: Double, autoplay: Bool) {
        calls.append("load \(wholeBookPosition) \(autoplay)")
    }

    func play() {
        calls.append("play")
    }

    func pause() {
        calls.append("pause")
    }

    func seek(toWholeBook position: Double, autoplay: Bool) {
        calls.append("seek \(position) \(autoplay)")
    }

    func setRate(_ rate: Float) {
        calls.append("rate \(rate)")
    }

    func stop() {
        calls.append("stop")
    }
}

@MainActor
struct AudiobookPlayerCastTests {
    /// Two files of two chapters each, as the server sends it.
    private func loadedPlayer(at position: Double = 30) throws -> AudiobookPlayer {
        let json = """
        {"edition_id": 5, "book_id": 6, "title": "Book", "authors": [], "total_duration_secs": 200,
         "files": [
           {"id": 1, "start_secs": 0, "duration_secs": 100, "size_bytes": 1, "sha256": null, "url": "/f/1"},
           {"id": 2, "start_secs": 100, "duration_secs": 100, "size_bytes": 1, "sha256": null, "url": "/f/2"}
         ],
         "chapters": [
           {"index": 0, "title": "A", "start_secs": 0, "end_secs": 50, "file_id": 1,
            "size_bytes": 1, "sha256": null, "url": "/f/1"},
           {"index": 1, "title": "B", "start_secs": 50, "end_secs": 100, "file_id": 1,
            "size_bytes": 1, "sha256": null, "url": "/f/1"},
           {"index": 2, "title": "C", "start_secs": 100, "end_secs": 150, "file_id": 2,
            "size_bytes": 1, "sha256": null, "url": "/f/2"},
           {"index": 3, "title": "D", "start_secs": 150, "end_secs": 200, "file_id": 2,
            "size_bytes": 1, "sha256": null, "url": "/f/2"}
         ]}
        """
        let manifest = try #require(BookManifest.decodePersisted(Data(json.utf8)))
        let player = AudiobookPlayer()
        try player.load(manifest: manifest, baseURL: #require(URL(string: "https://example.test")), resumeAt: position)
        return player
    }

    @Test func castingDropsLocalAudioAndLoadsTheReceiverWhereTheListenerIs() throws {
        let player = try loadedPlayer(at: 30)
        let route = RecordingRoute()

        player.beginCasting(route, loadBook: true)

        #expect(player.player == nil)
        #expect(player.isCasting)
        #expect(route.calls == ["load 30.0 true"])
    }

    @Test func aResumedSessionDoesNotReloadTheReceiver() throws {
        let player = try loadedPlayer()
        let route = RecordingRoute()

        player.beginCasting(route, loadBook: false)

        #expect(route.calls.isEmpty)
    }

    @Test func controlsGoToTheReceiver() throws {
        let player = try loadedPlayer(at: 30)
        let route = RecordingRoute()
        player.beginCasting(route, loadBook: false)

        player.play()
        player.skipForward(30)
        player.setRate(1.5)
        player.pause()

        #expect(route.calls == ["play", "seek 60.0 true", "rate 1.5", "pause"])
        #expect(player.player == nil)
    }

    @Test func receiverStatusMovesPositionChapterAndPlayState() throws {
        let player = try loadedPlayer(at: 30)
        player.beginCasting(RecordingRoute(), loadBook: false)

        player.applyCastStatus(wholeBookPosition: 160, playing: true)

        #expect(player.positionSecs == 160)
        #expect(player.currentChapterIndex == 3)
        #expect(player.isPlaying)
    }

    @Test func leavingCastResumesLocallyPausedWhereTheReceiverStopped() throws {
        let player = try loadedPlayer(at: 30)
        player.beginCasting(RecordingRoute(), loadBook: false)
        player.applyCastStatus(wholeBookPosition: 120, playing: true)

        player.endCasting()

        #expect(!player.isCasting)
        #expect(!player.isPlaying)
        #expect(player.positionSecs == 120)
        #expect(player.player != nil)
    }

    @Test func closingThePlayerEndsTheCastSession() throws {
        let player = try loadedPlayer()
        let route = RecordingRoute()
        player.beginCasting(route, loadBook: false)

        player.unload()

        #expect(!player.isCasting)
        #expect(route.calls == ["stop"])
    }

    @Test func statusAfterCastingEndedIsIgnored() throws {
        let player = try loadedPlayer(at: 30)
        player.beginCasting(RecordingRoute(), loadBook: false)
        player.endCasting()

        player.applyCastStatus(wholeBookPosition: 180, playing: true)

        #expect(player.positionSecs == 30)
        #expect(!player.isPlaying)
    }
}
