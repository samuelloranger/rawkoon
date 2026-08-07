import { describe, expect, it } from "bun:test";
import {
  buildDelugeScript,
  buildQbittorrentCommand,
  buildTransmissionScript,
  HOOK_PATH,
} from "@rawkoon/api/services/downloadClient/hookCommands";

const input = { baseUrl: "http://rawkoon:3000", token: "TOKEN123" };

describe("buildQbittorrentCommand", () => {
  it("substitutes the info hash with %I and carries the token in a header", () => {
    const cmd = buildQbittorrentCommand(input);
    expect(cmd).toContain(`http://rawkoon:3000${HOOK_PATH}?hash=%I`);
    expect(cmd).toContain('-H "X-Rawkoon-Token: TOKEN123"');
  });

  it("strips a trailing slash from the base URL", () => {
    const cmd = buildQbittorrentCommand({
      ...input,
      baseUrl: "http://rawkoon:3000/",
    });
    expect(cmd).toContain("http://rawkoon:3000/api/download-client");
    expect(cmd).not.toContain("3000//api");
  });

  it("keeps the token out of the query string", () => {
    const cmd = buildQbittorrentCommand(input);
    const url = new URL(cmd.match(/"(https?:\/\/[^"]+)"/)![1]);
    expect(url.search).toBe("?hash=%I");
  });

  it("uses no shell metacharacters, since qBittorrent does not use a shell", () => {
    const cmd = buildQbittorrentCommand(input);
    expect(cmd).not.toMatch(/[|;&><$`]/);
  });
});

describe("buildDelugeScript", () => {
  it("reads the info hash from the Execute plugin's first argument", () => {
    const script = buildDelugeScript(input);
    expect(script.startsWith("#!/bin/sh")).toBe(true);
    expect(script).toContain('hash="$1"');
    expect(script).toContain("X-Rawkoon-Token: TOKEN123");
    expect(script).toContain(`${HOOK_PATH}?hash=`);
  });
});

describe("buildTransmissionScript", () => {
  it("reads the info hash from TR_TORRENT_HASH", () => {
    const script = buildTransmissionScript(input);
    expect(script.startsWith("#!/bin/sh")).toBe(true);
    expect(script).toContain("$TR_TORRENT_HASH");
    expect(script).toContain("X-Rawkoon-Token: TOKEN123");
  });
});
