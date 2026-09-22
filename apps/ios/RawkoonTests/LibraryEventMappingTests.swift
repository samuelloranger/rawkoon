import Foundation
@testable import Rawkoon
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
           {"id":100,"progress":0.25,"state":"downloading","downloadSpeed":2048,"etaSeconds":30},
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
        #expect(items[1].id == 101)
        #expect(items[1].live.state == "stalled")
        #expect(items[1].live.etaSeconds == nil)
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
}
