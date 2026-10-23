import Foundation
@testable import Rawkoon
import Testing

struct AdminRequestBodyTests {
    private func encode(_ value: some Encodable) throws -> [String: Any] {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        let data = try encoder.encode(value)
        return try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    @Test func resetPasswordSendsThePasswordField() throws {
        let json = try encode(ResetPasswordBody(password: "correct horse"))
        #expect(json["password"] as? String == "correct horse")
        #expect(json.count == 1)
    }

    @Test func unlinkingSendsAnExplicitNull() throws {
        let json = try encode(LinkJellyfinUserBody(jellyfinUserId: nil))
        #expect(json.keys.contains("jellyfin_user_id"))
        #expect(json["jellyfin_user_id"] is NSNull)
    }

    @Test func linkingSendsTheJellyfinId() throws {
        let json = try encode(LinkJellyfinUserBody(jellyfinUserId: "abc"))
        #expect(json["jellyfin_user_id"] as? String == "abc")
    }
}
