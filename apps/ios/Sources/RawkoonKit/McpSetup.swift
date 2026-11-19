import Foundation

/// MCP client setup commands. Mirrors `apps/web/src/lib/mcpSetupCommands.ts` string for string.
public enum McpSetup {
    public struct Command: Equatable, Sendable {
        public let client: String
        public let command: String
        /// Printed under the command (e.g. the env-var caveat for Codex).
        public let hint: String?
    }

    /// The scopes a key can carry, in the order the web UI lists them.
    public static let scopes = ["read", "request", "approve", "admin"]

    public static let keyPlaceholder = "<your key>"

    /// `<server>/api/mcp`, tolerating trailing slashes on the stored server address.
    public static func endpoint(server: String) -> String {
        var base = server.trimmingCharacters(in: .whitespacesAndNewlines)
        while base.hasSuffix("/") {
            base.removeLast()
        }
        return "\(base)/api/mcp"
    }

    private static let safeUnquoted = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_@%+=:,./-")

    public static func shellQuote(_ value: String) -> String {
        if !value.isEmpty, value.allSatisfy({ safeUnquoted.contains($0) }) {
            return value
        }
        return "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    private static func doubleQuoted(_ value: String) -> String {
        var out = "\""
        for ch in value {
            if "\\\"`$".contains(ch) {
                out.append("\\")
            }
            out.append(ch)
        }
        return out + "\""
    }

    public static func commands(url: String, key: String) -> [Command] {
        let claude = "claude mcp add --scope user --transport http rawkoon \(shellQuote(url)) --header \(doubleQuoted("x-api-key: \(key)"))"
        let opencode = "opencode mcp add rawkoon --global --url \(shellQuote(url)) --header \(shellQuote("x-api-key=\(key)"))"
        let codex = [
            "export RAWKOON_API_KEY=\(shellQuote(key))",
            "codex mcp add rawkoon --url \(shellQuote(url)) --bearer-token-env-var RAWKOON_API_KEY",
        ].joined(separator: "\n")
        return [
            Command(client: "Claude Code", command: claude, hint: nil),
            Command(client: "OpenCode", command: opencode, hint: nil),
            Command(client: "Codex CLI", command: codex, hint: "The variable must be set in the shell that runs codex."),
        ]
    }
}
