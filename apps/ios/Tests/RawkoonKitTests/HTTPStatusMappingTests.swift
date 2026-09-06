import Foundation
@testable import RawkoonKit
import Testing

struct HTTPStatusMappingTests {
    @Test func splitsUnauthorizedAndForbidden() {
        #expect(HTTPStatusMapping.failure(status: 401, body: Data()) == .unauthorized)
        #expect(HTTPStatusMapping.failure(status: 403, body: Data()) == .forbidden)
    }

    @Test func surfacesServerErrorBody() {
        let body = Data(#"{"error":"Indexer timed out"}"#.utf8)
        #expect(
            HTTPStatusMapping.failure(status: 503, body: body)
                == .server(status: 503, message: "Indexer timed out")
        )
    }

    @Test func trimsAndRejectsEmptyError() {
        let padded = Data(#"{"error":"  nope  "}"#.utf8)
        #expect(HTTPStatusMapping.errorMessage(from: padded) == "nope")

        let empty = Data(#"{"error":"   "}"#.utf8)
        #expect(HTTPStatusMapping.failure(status: 500, body: empty) == .http(500))
    }

    @Test func fallsBackToHttpWhenBodyIsNotErrorJSON() {
        let body = Data(#"{"message":"nope"}"#.utf8)
        #expect(HTTPStatusMapping.failure(status: 502, body: body) == .http(502))
        #expect(HTTPStatusMapping.failure(status: 404, body: Data()) == .http(404))
    }

    @Test func doesNotTreatErrorBodyOn401AsServer() {
        let body = Data(#"{"error":"expired"}"#.utf8)
        #expect(HTTPStatusMapping.failure(status: 401, body: body) == .unauthorized)
    }
}
