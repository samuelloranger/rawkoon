// Attach the just-uploaded build to the internal TestFlight group so internal
// testers receive it automatically. Runs in CI after the altool upload.
//
// Env:
//   APP_STORE_CONNECT_KEY_ID       key id (kid)
//   APP_STORE_CONNECT_ISSUER_ID    issuer id
//   APP_STORE_CONNECT_KEY_PATH     path to the AuthKey_*.p8
//   BUNDLE_ID                      app bundle id (cloud.samlo.rawkoon)
//   BUILD_NUMBER                   CFBundleVersion of the uploaded build
//   WHATS_NEW                      optional "What to Test" text
//
// No third-party deps: Node built-in crypto + global fetch.

import { readFileSync } from "node:fs";
import { createPrivateKey, sign } from "node:crypto";

const KID = required("APP_STORE_CONNECT_KEY_ID");
const ISSUER = required("APP_STORE_CONNECT_ISSUER_ID");
const KEY_PATH = required("APP_STORE_CONNECT_KEY_PATH");
const BUNDLE_ID = required("BUNDLE_ID");
const WHATS_NEW = process.env.WHATS_NEW || "Latest internal build.";

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env ${name}`);
    process.exit(1);
  }
  return v;
}

const b64u = (b) => Buffer.from(b).toString("base64url");
const privateKey = createPrivateKey(readFileSync(KEY_PATH, "utf8"));

function jwt() {
  const header = b64u(JSON.stringify({ alg: "ES256", kid: KID, typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64u(JSON.stringify({ iss: ISSUER, iat: now, exp: now + 600, aud: "appstoreconnect-v1" }));
  const sig = sign("sha256", Buffer.from(`${header}.${payload}`), { key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${header}.${payload}.${sig.toString("base64url")}`;
}

async function api(path, method = "GET", body) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${jwt()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { /* empty body (e.g. 204) */ }
  return { ok: res.ok, status: res.status, json };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. App
const apps = await api(`/v1/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}`);
const app = apps.json.data?.[0];
if (!app) { console.error(`No app for bundle ${BUNDLE_ID}`); process.exit(1); }
console.log(`app ${app.id} ${app.attributes?.name}`);

// 2. Internal group
const groups = await api(`/v1/apps/${app.id}/betaGroups?limit=50`);
const internal = (groups.json.data || []).find((g) => g.attributes?.isInternalGroup);
if (!internal) { console.error("No internal beta group found"); process.exit(1); }
console.log(`internal group ${internal.id} "${internal.attributes?.name}"`);

// 3. Find the newest build for the app. App Store Connect assigns its own
//    build numbers, so we can't reliably filter by CFBundleVersion — the build
//    we just uploaded is simply the most recent one. Poll until one shows up.
let build = null;
for (let attempt = 1; attempt <= 40 && !build; attempt++) {
  const builds = await api(`/v1/builds?filter[app]=${app.id}&sort=-uploadedDate&limit=1`);
  build = builds.json.data?.[0] || null;
  if (!build) {
    console.log(`no build visible yet (attempt ${attempt}), waiting…`);
    await sleep(20_000);
  }
}
if (!build) { console.error("No build appeared to distribute"); process.exit(1); }
console.log(`latest build ${build.id} #${build.attributes?.version} state=${build.attributes?.processingState}`);

// 4. What-to-Test localization (best effort; internal testing doesn't require it)
const locs = await api(`/v1/builds/${build.id}/betaBuildLocalizations`);
const existing = (locs.json.data || []).find((l) => l.attributes?.locale === "en-US");
if (existing) {
  await api(`/v1/betaBuildLocalizations/${existing.id}`, "PATCH", {
    data: { type: "betaBuildLocalizations", id: existing.id, attributes: { whatsNew: WHATS_NEW } },
  });
} else {
  await api(`/v1/betaBuildLocalizations`, "POST", {
    data: {
      type: "betaBuildLocalizations",
      attributes: { locale: "en-US", whatsNew: WHATS_NEW },
      relationships: { build: { data: { type: "builds", id: build.id } } },
    },
  });
}

// 5. Attach the build to the internal group
const attach = await api(`/v1/betaGroups/${internal.id}/relationships/builds`, "POST", {
  data: [{ type: "builds", id: build.id }],
});
if (!attach.ok && attach.status !== 409) {
  console.error(`Attach failed: ${attach.status} ${JSON.stringify(attach.json).slice(0, 300)}`);
  process.exit(1);
}
console.log(`attached build #${build.attributes?.version} to "${internal.attributes?.name}" (status ${attach.status})`);
