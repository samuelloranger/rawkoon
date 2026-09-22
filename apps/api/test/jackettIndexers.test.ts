import { describe, expect, it } from "bun:test";
import { parseJackettIndexers } from "@rawkoon/api/services/indexerManager/jackettAdapter";

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<indexers>
  <indexer id="open-site" configured="true">
    <title>Open Site</title>
    <description>d</description>
    <type>public</type>
  </indexer>
  <indexer id="members-site" configured="true">
    <title>Members Site</title>
    <type>semi-private</type>
  </indexer>
  <indexer id="closed-site" configured="true">
    <title>Closed Site</title>
    <type>private</type>
  </indexer>
  <indexer id="mystery-site" configured="true">
    <title>Mystery Site</title>
  </indexer>
</indexers>`;

describe("parseJackettIndexers", () => {
  it("reads each indexer's type instead of assuming private", () => {
    const list = parseJackettIndexers(XML);
    expect(list.map((i) => [i.slug, i.name, i.privacy])).toEqual([
      ["closed-site", "Closed Site", "private"],
      ["members-site", "Members Site", "semiPrivate"],
      ["mystery-site", "Mystery Site", "private"],
      ["open-site", "Open Site", "public"],
    ]);
  });
});
