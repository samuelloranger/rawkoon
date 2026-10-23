import Foundation
@testable import Rawkoon
import Testing

struct SessionUserAvatarTests {
    private func decode(_ json: String) throws -> SessionUser {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode(SessionUser.self, from: Data(json.utf8))
    }

    @Test func decodesTheAvatarURL() throws {
        let user = try decode(#"{"id":"u1","first_name":"Alex","avatar_url":"https://rawkoon.example.com/api/users/avatar/a.png"}"#)
        #expect(user.avatarUrl == "https://rawkoon.example.com/api/users/avatar/a.png")
    }

    @Test func aMissingOrNullAvatarIsNil() throws {
        #expect(try decode(#"{"id":"u1","avatar_url":null}"#).avatarUrl == nil)
        #expect(try decode(#"{"id":"u1"}"#).avatarUrl == nil)
    }
}
