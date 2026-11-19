@testable import RawkoonKit
import Testing

struct McpSetupTests {
    private let url = "https://rawkoon.example.com/api/mcp"
    private let key = "rk_1234567890abcdef"

    @Test func shellQuoteLeavesPlainTokensAlone() {
        #expect(McpSetup.shellQuote(key) == key)
    }

    @Test func shellQuoteSingleQuotesMetacharacters() {
        #expect(McpSetup.shellQuote("a'b") == "'a'\\''b'")
        #expect(McpSetup.shellQuote("rm -rf") == "'rm -rf'")
    }

    @Test func coversTheThreeClientsWithEndpointAndKey() {
        let commands = McpSetup.commands(url: url, key: key)
        #expect(commands.map(\.client) == ["Claude Code", "OpenCode", "Codex CLI"])
        for c in commands {
            #expect(c.command.contains(url))
            #expect(c.command.contains(key))
        }
    }

    @Test func claudeAndOpencodeUseTheApiKeyHeader() {
        let commands = McpSetup.commands(url: url, key: key)
        #expect(commands[0].command == "claude mcp add --scope user --transport http rawkoon \(url) --header \"x-api-key: \(key)\"")
        #expect(commands[1].command == "opencode mcp add rawkoon --global --url \(url) --header x-api-key=\(key)")
    }

    @Test func codexUsesTheEnvVarWithAShellHint() {
        let codex = McpSetup.commands(url: url, key: key)[2]
        #expect(codex.command == "export RAWKOON_API_KEY=\(key)\ncodex mcp add rawkoon --url \(url) --bearer-token-env-var RAWKOON_API_KEY")
        #expect(codex.hint != nil)
    }

    @Test func quotesAKeyWithASpace() {
        let c = McpSetup.commands(url: url, key: "bad key")
        #expect(c[0].command.contains("\"x-api-key: bad key\""))
        #expect(c[1].command.contains("'x-api-key=bad key'"))
        #expect(c[2].command.contains("export RAWKOON_API_KEY='bad key'"))
    }

    @Test func quotesAUrlThatNeedsIt() {
        let spaced = "https://example.com/a b/api/mcp"
        let c = McpSetup.commands(url: spaced, key: key)
        #expect(c[0].command.contains("rawkoon '\(spaced)'"))
        #expect(c[1].command.contains("--url '\(spaced)'"))
        #expect(c[2].command.contains("--url '\(spaced)'"))
    }

    @Test func doubleQuotedEscapesShellSpecials() {
        let c = McpSetup.commands(url: url, key: "a$b`c\"d\\e")
        #expect(c[0].command.contains("\"x-api-key: a\\$b\\`c\\\"d\\\\e\""))
    }

    @Test func endpointTrimsTrailingSlashes() {
        #expect(McpSetup.endpoint(server: "https://h.example.com//") == "https://h.example.com/api/mcp")
        #expect(McpSetup.endpoint(server: "https://h.example.com") == "https://h.example.com/api/mcp")
    }
}
