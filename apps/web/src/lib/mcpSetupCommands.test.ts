import { describe, expect, it } from "vitest";
import { buildMcpSetupCommands, shellQuote } from "./mcpSetupCommands";

const URL = "https://rawkoon.example.com/api/mcp";
const KEY = "rk_1234567890abcdef";

describe("shellQuote", () => {
  it("leaves plain tokens unquoted", () => {
    expect(shellQuote(KEY)).toBe(KEY);
  });

  it("single-quotes anything with shell metacharacters", () => {
    expect(shellQuote("a'b")).toBe("'a'\\''b'");
    expect(shellQuote("rm -rf")).toBe("'rm -rf'");
  });
});

describe("buildMcpSetupCommands", () => {
  const commands = buildMcpSetupCommands(URL, KEY);

  it("covers the three clients with the endpoint and key", () => {
    expect(commands.map((c) => c.client)).toEqual([
      "Claude Code",
      "OpenCode",
      "Codex CLI",
    ]);
    for (const c of commands) {
      expect(c.command).toContain(URL);
      expect(c.command).toContain(KEY);
    }
  });

  it("uses the x-api-key header for Claude Code and OpenCode", () => {
    expect(commands[0].command).toBe(
      `claude mcp add --scope user --transport http rawkoon ${URL} --header "x-api-key: ${KEY}"`,
    );
    expect(commands[1].command).toBe(
      `opencode mcp add rawkoon --global --url ${URL} --header x-api-key=${KEY}`,
    );
  });

  it("uses the env var + bearer-token form for Codex, with the shell hint", () => {
    expect(commands[2].command).toBe(
      `export RAWKOON_API_KEY=${KEY}\ncodex mcp add rawkoon --url ${URL} --bearer-token-env-var RAWKOON_API_KEY`,
    );
    expect(commands[2].hint).toBeTruthy();
  });

  it("shell-quotes a key that contains a space", () => {
    const [claude, opencode, codex] = buildMcpSetupCommands(URL, "bad key");
    expect(claude.command).toContain('"x-api-key: bad key"');
    expect(opencode.command).toContain("'x-api-key=bad key'");
    expect(codex.command).toContain("export RAWKOON_API_KEY='bad key'");
  });

  it("shell-quotes a URL with characters that need it", () => {
    const url = "https://example.com/a b/api/mcp";
    const [claude, opencode, codex] = buildMcpSetupCommands(url, KEY);
    expect(claude.command).toContain(`rawkoon '${url}'`);
    expect(opencode.command).toContain(`--url '${url}'`);
    expect(codex.command).toContain(`--url '${url}'`);
  });
});
