# MCP server (AI clients)

Rawkoon exposes a small, task-shaped [Model Context Protocol](https://modelcontextprotocol.io)
server, so an AI client — Claude Code, Claude Desktop, OpenCode, Codex CLI, or
any MCP client — can search your library, check requests and downloads, and
create or decide title requests through Rawkoon's own permission checks.

The endpoint speaks MCP over "Streamable HTTP" (JSON-RPC 2.0) at:

```
https://rawkoon.example.com/api/mcp
```

It authenticates with a Rawkoon API key that has explicit MCP permissions.
A plain service key (like the one made for Labby) is refused.

## Scopes

Create a key in **Settings → API keys**, check the MCP access boxes you want,
and the setup commands are generated for you. Scopes live on the key, not on
the user, and can be edited later from the same dialog.

| Scope | Allows |
| --- | --- |
| `read` | `search`, `library_lookup`, `downloads`, `quality_profiles`, `calendar`, `my_requests`, `listening_progress` |
| `request` | `request_title` (add a title, or create a request), `cancel_request` |
| `approve` | `pending_requests`, `decide_request` |
| `admin` | `health` (the [doctor self-check](#the-health-tool)); additionally requires the key's owner to still be an admin |

A new key has no scopes by default. A valid key with no MCP scopes gets a 403
saying so; a missing or invalid key gets a 401 with `WWW-Authenticate: Bearer realm="rawkoon"`.
`GET` and `DELETE` on the endpoint answer 405 (`Allow: POST`). The key acts as its owner: every tool call
replays Rawkoon's own routes in-process as that user, so normal permission
checks apply — an `admin` scope on a key owned by a non-admin is ignored, and
`approve` tools only work for an admin owner.

## Client configuration

### Claude Code

```bash
claude mcp add --scope user --transport http rawkoon https://rawkoon.example.com/api/mcp --header "x-api-key: <key>"
```

`--scope user` makes the server available in every folder. Without it, Claude Code saves it for the current folder only.

### Claude Desktop

Add a server entry to the Claude Desktop MCP configuration:

```json
{
  "mcpServers": {
    "rawkoon": {
      "type": "http",
      "url": "https://rawkoon.example.com/api/mcp",
      "headers": {
        "x-api-key": "<key>"
      }
    }
  }
}
```

### OpenCode

```bash
opencode mcp add rawkoon --global --url https://rawkoon.example.com/api/mcp --header x-api-key=<key>
```

Or in `opencode.json`:

```json
{
  "mcp": {
    "rawkoon": {
      "type": "remote",
      "url": "https://rawkoon.example.com/api/mcp",
      "headers": {
        "x-api-key": "<key>"
      }
    }
  }
}
```

### Codex CLI

Codex reads the key from an environment variable rather than the command line,
which is why the endpoint also accepts `Authorization: Bearer <key>`:

```bash
export RAWKOON_API_KEY=<key>
codex mcp add rawkoon --url https://rawkoon.example.com/api/mcp --bearer-token-env-var RAWKOON_API_KEY
```

The variable must be set in the shell that runs `codex`. Or in
`~/.codex/config.toml`:

```toml
[mcp_servers.rawkoon]
url = "https://rawkoon.example.com/api/mcp"
bearer_token_env_var = "RAWKOON_API_KEY"
```

## Tools

| Tool | Scope | What it does |
| --- | --- | --- |
| `search` | read | Title search (movies/shows via TMDB, books via Google Books when enabled) with library status. The query needs at least 2 characters; with books turned off, `books` carries `enabled: false` and a note. |
| `library_lookup` | read | Is a title in the library: status, missing episodes, file quality (`resolution` as a number), audio languages, and `tmdb_id` to match search results. |
| `downloads` | read | The current download queue (admin owner only): `progress_percent` (0-100), `state`, `download_speed_bytes_per_s` and `eta_seconds`. |
| `quality_profiles` | read | Quality profiles with their ids and `default_for` (movie/show; `null` when the key's owner can't read the defaults): the `quality_profile_id` that `decide_request` (approve) and `request_title` take. |
| `calendar` | read | Upcoming releases and episodes from today through the next N days (default 7, max 30); "today" is the server's `TZ`, so same-day releases are included. |
| `my_requests` | read | The key owner's requests and their state. |
| `listening_progress` | read | Where the owner is in their audiobooks and ebooks (audiobook positions in whole seconds). |
| `request_title` | request | Add a title (admin owner) or create a request (anyone else), with quality profile and season choice. |
| `cancel_request` | request | Withdraw a pending or denied request (by id from `my_requests`): the owner's own, or anyone's for an admin owner. Same rules as `DELETE /api/requests/:id`. |
| `pending_requests` | approve | Requests waiting for approval, with `tmdb_id` / `google_volume_id`, `season_mode` and any `quality_profile_id`. |
| `decide_request` | approve | Approve (with a quality profile) or deny one request (admin owner; checked before a token is issued). |
| `health` | admin | The doctor self-check report. |

Results are kept model-sized: strings are capped at 300 characters and lists at
25 items with a `truncated` flag and total count, so the client narrows its
query instead of assuming a list is complete.

Tool failures come back with `isError: true` and the message as text only; they
carry no `structuredContent`, since MCP requires that to be an object.

## The confirm flow for ACTION tools

`request_title`, `cancel_request` and `decide_request` change state, so they run in two steps:

1. The first call **does nothing**. It returns a plain-English `summary` of
   what will happen, a `confirm_token`, and `expires_in_s: 300`.
2. The AI shows the summary to the person. If they agree, the same tool is
   called again with the same arguments plus the token; that call performs the
   action.

The token is single-use, stored in Valkey for five minutes, and bound to the
key, the tool, and the exact arguments. A reused, expired, or mismatched token
returns a plain error telling the client to start over — the action never runs.
A token is consumed the moment the confirmed call is accepted: if the
arguments don't match, or the action itself then fails, the error says the
token is used up and the client must call the tool again without
`confirm_token` for a new one. The `decide_request` summary names the request
and the quality profile (falling back to ids if the lookup fails); the
requester-written title is flattened and shortened so it reads as data, not
instructions.

## Rate limits

Each key gets 60 read tools per minute and 10 performed actions per hour in
Valkey. Over the limit, the tool answers with an error saying when to retry.
An unconfirmed summary call counts as one read; only the performed action
spends the action budget.

## The health tool

The `health` tool (scope `admin`) returns the same report as
**Settings → Doctor**: a per-check status, summary, and suggested fix, with an
overall status. It only works while the key's owner is an administrator.
