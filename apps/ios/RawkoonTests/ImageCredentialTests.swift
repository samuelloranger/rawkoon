import Foundation
@testable import Rawkoon
import Testing

struct ImageCredentialTests {
    private func token(for raw: String) throws -> String? {
        let server = try #require(URL(string: "https://rawkoon.example.com"))
        return try ImageCredential(server: server, token: "t").token(for: #require(URL(string: raw)))
    }

    @Test func sendsTheTokenToItsOwnServer() throws {
        #expect(try token(for: "https://rawkoon.example.com/api/dashboard/jellyfin/image?itemId=1") == "t")
    }

    @Test func neverSendsTheTokenElsewhere() throws {
        #expect(try token(for: "https://image.tmdb.org/t/p/w500/a.jpg") == nil)
        #expect(try token(for: "http://rawkoon.example.com/a.jpg") == nil)
        #expect(try token(for: "https://rawkoon.example.com:8443/a.jpg") == nil)
        #expect(try token(for: "https://rawkoon.example.com.evil.test/a.jpg") == nil)
    }
}
