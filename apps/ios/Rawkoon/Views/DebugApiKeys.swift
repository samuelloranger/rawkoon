#if DEBUG
    // motion-ok-file: debug-only harness
    import SwiftUI

    /// Fixtures of the API key screens —
    /// `RAWKOON_SCREEN=apiKeys|apiKeyCreate|apiKeyCreated|apiKeyEdit`.
    struct DebugApiKeys: View {
        let screen: String
        @Environment(AppModel.self) private var model

        private static let keys = [
            ApiKeyDTO(
                id: "1", name: "Labby", start: "rk_Ab3", prefix: nil, enabled: true, mcpScopes: [],
                lastUsedAt: "2026-11-01T12:00:00.000Z", expiresAt: nil, createdAt: "2026-09-01T12:00:00.000Z"
            ),
            ApiKeyDTO(
                id: "2", name: "Claude Code", start: "rk_Zq9", prefix: nil, enabled: true,
                mcpScopes: ["read", "request"], lastUsedAt: nil, expiresAt: "2027-01-01T00:00:00.000Z",
                createdAt: "2026-11-10T12:00:00.000Z"
            ),
        ]

        var body: some View {
            NavigationStack {
                switch screen {
                case "apiKeyCreate":
                    CreateApiKeySheet(onDone: {})
                case "apiKeyCreated":
                    CreateApiKeySheet(
                        onDone: {},
                        initialCreated: CreateApiKeyResponse(key: "rk_0123456789abcdefXYZ", apiKey: Self.keys[1])
                    )
                case "apiKeyEdit":
                    EditMcpScopesSheet(apiKey: Self.keys[1], onSaved: {})
                default:
                    Form {
                        ForEach(Self.keys) { ApiKeyRow(key: $0).listRowBackground(Theme.raised) }
                    }
                    .scrollContentBackground(.hidden)
                    .background(Theme.base)
                    .navigationTitle("API keys")
                    .navigationBarTitleDisplayMode(.inline)
                }
            }
            .onAppear { model.serverURL = "https://rawkoon.example.com" }
        }
    }
#endif
