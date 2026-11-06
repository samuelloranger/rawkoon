import Foundation
@testable import Rawkoon
import RawkoonKit
import Testing

/// Covers the SSE stream's DTO → `LibraryEvent` mapping, including the decode of
/// a `download-progress` payload the same way `sseStream` decodes it.
struct LibraryEventMappingTests {
    private func decode(_ json: String) throws -> LibraryEventDTO {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode(LibraryEventDTO.self, from: Data(json.utf8))
    }

    @Test func handshakeWins() throws {
        let dto = try decode(#"{"connected":true,"ts":1}"#)
        guard case .handshake = LibraryEvent.from(dto) else {
            Issue.record("expected handshake")
            return
        }
    }

    @Test func mediaEventFromBareMediaId() throws {
        let dto = try decode(#"{"kind":"media","mediaId":42,"ts":1}"#)
        guard case let .media(id) = LibraryEvent.from(dto) else {
            Issue.record("expected media")
            return
        }
        #expect(id == 42)
    }

    @Test func bookEventNeedsBookKind() throws {
        let dto = try decode(#"{"kind":"book","bookId":7,"ts":1}"#)
        guard case let .book(id) = LibraryEvent.from(dto) else {
            Issue.record("expected book")
            return
        }
        #expect(id == 7)
    }

    @Test func seedStateEventIsIgnored() throws {
        let dto = try decode(#"{"kind":"seed-state","ts":1,"torrents":[]}"#)
        #expect(LibraryEvent.from(dto) == nil)
    }

    @Test func downloadProgressDecodesEntries() throws {
        let dto = try decode(#"""
        {"kind":"download-progress","mediaId":10,"ts":1,
         "downloads":[
           {"id":100,"progress":0.25,"state":"downloading","downloadSpeed":2048,"etaSeconds":30,"seeds":12,"peers":4},
           {"id":101,"progress":0.9,"state":"stalled","downloadSpeed":0,"etaSeconds":null}
         ]}
        """#)
        guard case let .downloadProgress(mediaId, items) = LibraryEvent.from(dto) else {
            Issue.record("expected downloadProgress")
            return
        }
        #expect(mediaId == 10)
        #expect(items.count == 2)
        #expect(items[0].id == 100)
        #expect(items[0].live.progress == 0.25)
        #expect(items[0].live.downloadSpeed == 2048)
        #expect(items[0].live.etaSeconds == 30)
        #expect(items[0].live.seeds == 12)
        #expect(items[0].live.peers == 4)
        #expect(items[1].id == 101)
        #expect(items[1].live.state == "stalled")
        #expect(items[1].live.etaSeconds == nil)
        #expect(items[1].live.seeds == nil)
    }

    @Test func downloadProgressWithoutRowsIsNotProgress() throws {
        // Missing `downloads` falls through to the media branch on the mediaId.
        let dto = try decode(#"{"kind":"download-progress","mediaId":10,"ts":1}"#)
        guard case let .media(id) = LibraryEvent.from(dto) else {
            Issue.record("expected media fallthrough")
            return
        }
        #expect(id == 10)
    }

    @Test func landedEventCarriesTheArrival() throws {
        let dto = try decode(#"""
        {"kind":"landed","mediaId":5,"mediaType":"tv","title":"Show (2024)","posterUrl":"/p.jpg",
         "season":1,"episode":4,"episodeCount":null,"ts":1700000000000}
        """#)
        guard case let .landed(arrival) = LibraryEvent.from(dto) else {
            Issue.record("expected landed")
            return
        }
        #expect(arrival.mediaId == 5)
        #expect(arrival.title == "Show (2024)")
        #expect(arrival.code == "S01E04")
        #expect(arrival.posterUrl == "/p.jpg")
        #expect(arrival.ts == 1_700_000_000_000)
    }

    @Test func landedWithoutTitleFallsBackToMedia() throws {
        let dto = try decode(#"{"kind":"landed","mediaId":5,"ts":1}"#)
        guard case let .media(id) = LibraryEvent.from(dto) else {
            Issue.record("expected media fallthrough")
            return
        }
        #expect(id == 5)
    }

    @Test func searchResultDecodesHeldTargets() throws {
        let dto = try decode(
            #"{"kind":"search_result","media_id":9,"outcome":"delayed","delay_until":"2026-01-01T00:30:00.000Z","target_keys":["a","b"],"ts":1}"#
        )
        guard case let .searchResult(result) = LibraryEvent.from(dto) else {
            Issue.record("expected search result")
            return
        }
        #expect(result.mediaId == 9)
        #expect(result.outcome == .delayed)
        #expect(result.targetKeys == ["a", "b"])
    }

    @Test func searchResultDecodesGrabbedRelease() throws {
        let dto = try decode(
            #"{"kind":"search_result","media_id":9,"season":2,"outcome":"grabbed","release":{"title":"X.1080p","resolution":1080,"source":"WEB-DL","size_bytes":5000000000},"ts":1}"#
        )
        guard case let .searchResult(result) = LibraryEvent.from(dto) else {
            Issue.record("expected search result")
            return
        }
        #expect(result.season == 2)
        #expect(result.releaseTitle == "X.1080p")
        #expect(result.sizeBytes == 5_000_000_000)
    }

    @Test func singleTargetKeyBecomesAList() throws {
        let dto = try decode(#"{"kind":"search_result","media_id":9,"outcome":"delayed","target_key":"k","ts":1}"#)
        guard case let .searchResult(result) = LibraryEvent.from(dto) else {
            Issue.record("expected search result")
            return
        }
        #expect(result.targetKeys == ["k"])
    }

    @Test func unknownSearchOutcomeIsDroppedNotRefreshed() throws {
        let dto = try decode(#"{"kind":"search_result","media_id":9,"outcome":"mystery","ts":1}"#)
        #expect(LibraryEvent.from(dto) == nil)
    }
}
