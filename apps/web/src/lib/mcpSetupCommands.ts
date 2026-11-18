/**
 * MCP client setup commands, kept in one pure function so the three formats
 * (Claude Code, OpenCode, Codex CLI) are unit-tested and easy to change.
 */

export interface McpSetupCommand {
  client: string;
  command: string;
  /** Printed under the command (e.g. the env-var caveat for Codex). */
  hint?: string;
}

// Keys are plain alphanumeric tokens, but quoting defensively keeps a
// copy-pasted command safe if the key format ever changes.
const SAFE_UNQUOTED = /^[A-Za-z0-9_@%+=:,./-]+$/;

export function shellQuote(value: string): string {
  if (SAFE_UNQUOTED.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function doubleQuoted(value: string): string {
  return `"${value.replace(/([\\"`$])/g, "\\$1")}"`;
}

export function buildMcpSetupCommands(
  url: string,
  key: string,
): McpSetupCommand[] {
  // --scope user: the default local scope ties the server to the folder the command runs in.
  const claude = `claude mcp add --scope user --transport http rawkoon ${shellQuote(url)} --header ${doubleQuoted(`x-api-key: ${key}`)}`;
  const opencode = `opencode mcp add rawkoon --global --url ${shellQuote(url)} --header ${shellQuote(`x-api-key=${key}`)}`;
  const codex = [
    `export RAWKOON_API_KEY=${shellQuote(key)}`,
    `codex mcp add rawkoon --url ${shellQuote(url)} --bearer-token-env-var RAWKOON_API_KEY`,
  ].join("\n");

  return [
    { client: "Claude Code", command: claude },
    { client: "OpenCode", command: opencode },
    {
      client: "Codex CLI",
      command: codex,
      hint: "The variable must be set in the shell that runs codex.",
    },
  ];
}
