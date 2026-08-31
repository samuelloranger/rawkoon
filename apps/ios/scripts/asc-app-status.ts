#!/usr/bin/env bun
/**
 * Is the App Store Connect app record for rawkoon there yet?
 *
 * The ASC API cannot create an app record — POST /v1/apps returns
 * "The resource 'apps' does not allow 'CREATE'" — so the record has to be made
 * once by hand in the web UI. Everything else in the TestFlight lane is
 * automated; this tells you whether that one manual step is done.
 *
 * Reads the key and issuer from ~/.appstoreconnect/. Prints nothing secret.
 */
import { readFileSync } from "node:fs";
import { createPrivateKey, sign } from "node:crypto";

const BUNDLE_ID = "cloud.samlo.rawkoon";
const KEY_ID = process.env.ASC_KEY_ID ?? "699JSF8FFK";
const home = process.env.HOME ?? "";

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");

function token(): string {
  const issuer = readFileSync(`${home}/.appstoreconnect/issuer_id`, "utf8").trim();
  const pem = readFileSync(`${home}/.appstoreconnect/AuthKey_${KEY_ID}.p8`, "utf8");
  const header = b64u(JSON.stringify({ alg: "ES256", kid: KEY_ID, typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64u(JSON.stringify({ iss: issuer, iat: now, exp: now + 600, aud: "appstoreconnect-v1" }));
  const sig = sign("sha256", Buffer.from(`${header}.${payload}`), {
    key: createPrivateKey(pem),
    dsaEncoding: "ieee-p1363",
  });
  return `${header}.${payload}.${sig.toString("base64url")}`;
}

const res = await fetch(
  `https://api.appstoreconnect.apple.com/v1/apps?filter[bundleId]=${BUNDLE_ID}`,
  { headers: { Authorization: `Bearer ${token()}` } },
);
if (!res.ok) {
  console.error(`ASC API returned ${res.status}. The key may be revoked.`);
  process.exit(2);
}
const body = (await res.json()) as { data?: Array<{ id: string; attributes?: { name?: string } }> };
const app = body.data?.[0];
if (!app) {
  console.log(`NOT READY — no App Store Connect record for ${BUNDLE_ID}.`);
  console.log("Create it at https://appstoreconnect.apple.com/apps :");
  console.log("  Name: Rawkoon   Bundle ID: cloud.samlo.rawkoon   SKU: rawkoon-ios   Platform: iOS");
  process.exit(1);
}
console.log(`READY — app ${app.id} "${app.attributes?.name}" for ${BUNDLE_ID}.`);
