import { expect, test } from "bun:test";

import {
  contractIDs,
  registeredSseRouteIDs,
  validateSseContract,
} from "@rawkoon/api/contracts/sseContract";

test("declares every SSE route and payload kind exactly once", () => {
  expect(validateSseContract()).toEqual([]);
  expect(contractIDs()).toEqual([
    "library.media-update",
    "library.book-update",
    "library.handshake",
    "notifications.notification",
    "notifications.handshake",
    "library.migrate-status",
    "admin.jobs-status",
  ]);
  expect(registeredSseRouteIDs()).toEqual(contractIDs());
});

test("contract IDs are unique and use an iOS handling policy", () => {
  const ids = contractIDs();
  expect(new Set(ids).size).toBe(ids.length);
  expect(validateSseContract()).toEqual([]);
});
