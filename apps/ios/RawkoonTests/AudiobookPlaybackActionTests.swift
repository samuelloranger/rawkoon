@testable import Rawkoon
import Testing

@MainActor
struct AudiobookPlaybackActionTests {
    /// Simulates AppModel's playback surface: `openPlayer` loads an edition (or
    /// leaves it unloaded on failure), and `play` optionally reports an error.
    final class FakeAdapter: AudiobookPlaybackAdapting {
        var isLoggedIn = true
        var loadedEditionId: Int?
        var lastError: String?
        var playCalled = false
        /// Given the requested id, return what `openPlayer` leaves behind.
        var onOpen: (Int) -> (loaded: Int?, error: String?) = { ($0, nil) }
        /// Error `play` surfaces via `lastError`, if any.
        var playError: String?

        func openPlayer(editionId: Int) async {
            let result = onOpen(editionId)
            loadedEditionId = result.loaded
            lastError = result.error
        }

        func play() {
            playCalled = true
            if let playError {
                lastError = playError
            }
        }
    }

    @Test func loggedOutDoesNotPlay() async {
        let adapter = FakeAdapter()
        adapter.isLoggedIn = false
        let result = await AudiobookPlaybackAction(adapter: adapter).run(editionId: 7)
        #expect(result == .loggedOut)
        #expect(adapter.playCalled == false)
    }

    @Test func unknownEditionDoesNotPlay() async {
        let adapter = FakeAdapter()
        adapter.onOpen = { _ in (loaded: nil, error: "Not found") }
        let result = await AudiobookPlaybackAction(adapter: adapter).run(editionId: 7)
        #expect(result == .notFound)
        #expect(adapter.playCalled == false)
    }

    @Test func manifestFailureDoesNotPlay() async {
        let adapter = FakeAdapter()
        adapter.onOpen = { _ in (loaded: nil, error: "Enter a valid server URL.") }
        let result = await AudiobookPlaybackAction(adapter: adapter).run(editionId: 7)
        #expect(result == .notFound)
        #expect(adapter.playCalled == false)
    }

    @Test func playbackErrorSurfaces() async {
        let adapter = FakeAdapter()
        adapter.onOpen = { (loaded: $0, error: nil) }
        adapter.playError = "Couldn't play chapter"
        let result = await AudiobookPlaybackAction(adapter: adapter).run(editionId: 7)
        #expect(result == .playbackFailed("Couldn't play chapter"))
        #expect(adapter.playCalled == true)
    }

    @Test func successPlays() async {
        let adapter = FakeAdapter()
        adapter.onOpen = { (loaded: $0, error: nil) }
        let result = await AudiobookPlaybackAction(adapter: adapter).run(editionId: 7)
        #expect(result == .played)
        #expect(adapter.playCalled == true)
    }
}
