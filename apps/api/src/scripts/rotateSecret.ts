/**
 * Re-encrypt every stored secret from an OLD SECRET_KEY to a NEW one.
 *
 * Rotating SECRET_KEY without this leaves every encrypted value (integration
 * API keys/passwords, OIDC client secrets) undecryptable — which used to fail
 * silently (see crypto.ts). Run this as part of any key rotation.
 *
 * Usage (from repo root):
 *   OLD_SECRET_KEY=<current> NEW_SECRET_KEY=<new> bun run rotate-secret            # dry run
 *   OLD_SECRET_KEY=<current> NEW_SECRET_KEY=<new> bun run rotate-secret --commit   # persist
 *
 * OLD_SECRET_KEY defaults to SECRET_KEY from the loaded .env, so usually you
 * only need to provide NEW_SECRET_KEY. Nothing is written without --commit.
 * After a successful --commit, set SECRET_KEY=<new> in the environment.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { prisma } from "../db";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const ENC_PREFIX = "enc:";

const keyFrom = (secret: string): Buffer =>
  createHash("sha256").update(secret).digest();

function encryptWith(key: Buffer, text: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(text, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptWith(key: Buffer, text: string): string {
  const parts = text.slice(ENC_PREFIX.length).split(":");
  if (parts.length !== 3) throw new Error("malformed ciphertext");
  const [ivHex, authTagHex, encryptedHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const encrypted = Buffer.from(encryptedHex, "hex");
  if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH)
    throw new Error("malformed ciphertext: bad iv/authTag length");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    "utf8",
  );
}

const isEncrypted = (v: unknown): v is string =>
  typeof v === "string" && v.startsWith(ENC_PREFIX);

async function main() {
  const commit = process.argv.includes("--commit");
  const oldSecret = Bun.env.OLD_SECRET_KEY ?? Bun.env.SECRET_KEY;
  const newSecret = Bun.env.NEW_SECRET_KEY;

  if (!oldSecret) {
    console.error(
      "OLD_SECRET_KEY (or SECRET_KEY) must be set to the current key.",
    );
    process.exit(1);
  }
  if (!newSecret) {
    console.error("NEW_SECRET_KEY must be set to the key you are rotating to.");
    process.exit(1);
  }
  if (oldSecret === newSecret) {
    console.error("OLD and NEW keys are identical — nothing to rotate.");
    process.exit(1);
  }

  const oldKey = keyFrom(oldSecret);
  const newKey = keyFrom(newSecret);

  // Fail fast if the OLD key is wrong: reveal it now, not after partial writes.
  const rewrap = (value: string, where: string): string => {
    let plain: string;
    try {
      plain = decryptWith(oldKey, value);
    } catch (error) {
      throw new Error(
        `${where}: could not decrypt with the OLD key — is OLD_SECRET_KEY correct? (${
          error instanceof Error ? error.message : String(error)
        })`,
        { cause: error },
      );
    }
    return encryptWith(newKey, plain);
  };

  console.log(`Rotating secrets (${commit ? "COMMIT" : "dry run"})...\n`);
  let fieldCount = 0;

  const integrations = await prisma.integration.findMany({
    select: { id: true, type: true, config: true },
  });
  const integrationUpdates: { id: number; config: Record<string, unknown> }[] =
    [];
  for (const row of integrations) {
    if (!row.config || typeof row.config !== "object") continue;
    const cfg = row.config as Record<string, unknown>;
    const next: Record<string, unknown> = { ...cfg };
    const changedKeys: string[] = [];
    for (const [k, v] of Object.entries(cfg)) {
      if (isEncrypted(v)) {
        next[k] = rewrap(v, `integration "${row.type}" field "${k}"`);
        changedKeys.push(k);
      }
    }
    if (changedKeys.length > 0) {
      integrationUpdates.push({ id: row.id, config: next });
      fieldCount += changedKeys.length;
      console.log(`  integration "${row.type}": ${changedKeys.join(", ")}`);
    }
  }

  const providers = await prisma.oidcProvider.findMany({
    select: { id: true, slug: true, clientSecret: true },
  });
  const providerUpdates: { id: string; clientSecret: string }[] = [];
  for (const p of providers) {
    if (isEncrypted(p.clientSecret)) {
      providerUpdates.push({
        id: p.id,
        clientSecret: rewrap(p.clientSecret, `oidc provider "${p.slug}"`),
      });
      fieldCount += 1;
      console.log(`  oidc provider "${p.slug}": client_secret`);
    }
  }

  console.log(
    `\n${fieldCount} field(s) across ${integrationUpdates.length} integration(s) and ${providerUpdates.length} provider(s).`,
  );

  if (fieldCount === 0) {
    console.log("Nothing to rotate.");
    await prisma.$disconnect();
    return;
  }

  if (!commit) {
    console.log(
      "\nDry run — no changes written. Re-run with --commit to apply.",
    );
    await prisma.$disconnect();
    return;
  }

  await prisma.$transaction([
    ...integrationUpdates.map((u) =>
      prisma.integration.update({
        where: { id: u.id },
        data: { config: u.config as object },
      }),
    ),
    ...providerUpdates.map((u) =>
      prisma.oidcProvider.update({
        where: { id: u.id },
        data: { clientSecret: u.clientSecret },
      }),
    ),
  ]);

  console.log(
    "\nDone. Now set SECRET_KEY to the new value and restart the app.",
  );
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(
    `\nRotation aborted (no changes written): ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  await prisma.$disconnect();
  process.exit(1);
});
