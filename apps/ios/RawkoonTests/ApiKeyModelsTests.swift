import Foundation
@testable import Rawkoon
import Testing

/// Fixtures are shaped like `CreateApiKeyResponse` / `ApiKeysResponse` in `apps/shared/src/types/admin.ts`.
struct ApiKeyModelsTests {
    private let keyJSON = """
    {"id": "k1", "name": "ci", "start": "rk_ab", "prefix": null, "enabled": true,
     "mcp_scopes": ["read", "admin"], "last_used_at": "2026-01-02T03:04:05.000Z",
     "expires_at": null, "created_at": "2026-01-01T00:00:00.000Z"}
    """

    private func decode<T: Decodable>(_ json: String) throws -> T {
        try APIClient.mediaDecoder.decode(T.self, from: Data(json.utf8))
    }

    private func encoded(_ body: some Encodable) throws -> [String: Any] {
        let data = try APIClient.mediaEncoder.encode(body)
        return try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    @Test func decodesTheKeyList() throws {
        let list: ApiKeysResponse = try decode("{\"api_keys\": [\(keyJSON)]}")
        let key = try #require(list.apiKeys.first)
        #expect(key.mcpScopes == ["read", "admin"])
        #expect(key.lastUsedAt != nil)
        #expect(key.expiresAt == nil)
    }

    @Test func decodesTheCreateResponseWithThePlaintextKey() throws {
        let created: CreateApiKeyResponse = try decode("{\"key\": \"rk_secret\", \"api_key\": \(keyJSON)}")
        #expect(created.key == "rk_secret")
        #expect(created.apiKey.id == "k1")
    }

    @Test func createBodySendsSnakeCaseFields() throws {
        let json = try encoded(CreateApiKeyBody(name: "ci", expiresInDays: 30, mcpScopes: ["read"]))
        #expect(json["expires_in_days"] as? Int == 30)
        #expect(json["mcp_scopes"] as? [String] == ["read"])
    }

    @Test func updateBodySendsMcpScopes() throws {
        let json = try encoded(UpdateApiKeyScopesBody(mcpScopes: []))
        #expect(json["mcp_scopes"] as? [String] == [])
    }
}
