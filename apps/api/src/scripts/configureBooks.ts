/**
 * Configure the books feature on an existing install.
 *
 * Sets the library paths, enables the feature flag, and stores the Google
 * Books API key as an ENCRYPTED integration row — the key cannot be written
 * with raw SQL, because normalizeGoogleBooksConfig decrypts whatever it finds
 * and treats a plaintext value as unconfigured.
 *
 * Usage (from the monorepo root):
 *   cd apps/api && bun --env-file=../../.env src/scripts/configureBooks.ts \
 *     --books-path /mnt/storage/Books \
 *     --audiobooks-path /mnt/storage/Audiobooks \
 *     --google-key AIza... \
 *     --enable
 *
 * Inside the production container:
 *   docker compose exec rawkoon bun apps/api/src/scripts/configureBooks.ts --status
 *
 * --fix-languages re-derives every stored book's language from its ISBN and
 * corrects rows where the provider's value disagrees. Needed because rows added
 * before the reconciliation existed kept whatever the provider said.
 *
 * Flags are all optional; --status prints the current state and changes nothing.
 */

import { prisma } from "@rawkoon/api/db";
import { reconcileBookLanguage } from "@rawkoon/shared/utils";
import { encrypt } from "@rawkoon/api/services/crypto";
import { invalidateIntegrationConfigCache } from "@rawkoon/api/services/integrationConfigCache";

const argValue = (name: string): string | null => {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return null;
  const value = process.argv[idx + 1];
  if (!value || value.startsWith("--")) return null;
  return value;
};

const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

async function printStatus(): Promise<void> {
  const [app, media, integration, profiles, bookCount] = await Promise.all([
    prisma.appSettings.findUnique({
      where: { id: 1 },
      select: { booksEnabled: true },
    }),
    prisma.mediaSettings.findUnique({
      where: { id: 1 },
      select: {
        booksLibraryPath: true,
        audiobooksLibraryPath: true,
        bookTemplate: true,
        audiobookTemplate: true,
        postProcessingEnabled: true,
        fileOperation: true,
      },
    }),
    prisma.integration.findFirst({
      where: { type: "googlebooks" },
      select: { enabled: true, config: true },
    }),
    prisma.bookQualityProfile.findMany({
      select: { id: true, name: true, kind: true, allowedFormats: true },
      orderBy: { name: "asc" },
    }),
    prisma.libraryBook.count(),
  ]);

  const cfg = integration?.config as { api_key?: string } | null;

  console.log("Books configuration");
  console.log(`  books_enabled        : ${app?.booksEnabled ?? false}`);
  console.log(
    `  books path           : ${media?.booksLibraryPath ?? "(unset)"}`,
  );
  console.log(
    `  audiobooks path      : ${media?.audiobooksLibraryPath ?? "(unset)"}`,
  );
  console.log(`  book template        : ${media?.bookTemplate ?? "(unset)"}`);
  console.log(
    `  audiobook template   : ${media?.audiobookTemplate ?? "(unset)"}`,
  );
  console.log(
    `  post-processing      : ${media?.postProcessingEnabled ? "on" : "OFF (imports will not run)"}`,
  );
  console.log(`  file operation       : ${media?.fileOperation ?? "(unset)"}`);
  console.log(
    `  googlebooks          : ${
      integration
        ? `${integration.enabled ? "enabled" : "disabled"}, key ${cfg?.api_key ? "set" : "MISSING"}`
        : "(no integration row)"
    }`,
  );
  console.log(`  books in library     : ${bookCount}`);
  console.log(`  quality profiles     : ${profiles.length}`);
  for (const p of profiles) {
    console.log(
      `    - ${p.name} [${p.kind}] ${p.allowedFormats.join(" > ") || "(no formats)"}`,
    );
  }
}

/**
 * Correct stored languages against their ISBN registration group.
 *
 * Google Books reports a wrong language often enough to matter, and rows added
 * before ingest-time reconciliation kept the bad value.
 */
async function fixLanguages(apply: boolean): Promise<void> {
  const books = await prisma.libraryBook.findMany({
    select: { id: true, title: true, language: true, isbn13: true },
    orderBy: { id: "asc" },
  });

  let changed = 0;
  for (const b of books) {
    const { language, correctedFrom } = reconcileBookLanguage(
      b.language,
      b.isbn13,
    );
    if (!correctedFrom) continue;
    changed++;
    console.log(
      `${apply ? "fixed" : "would fix"}  #${b.id} ${b.title}: ${correctedFrom} -> ${language}`,
    );
    if (apply) {
      await prisma.libraryBook.update({
        where: { id: b.id },
        data: { language },
      });
    }
  }

  console.log(
    changed === 0
      ? `Checked ${books.length} book(s); every language agrees with its ISBN.`
      : `${apply ? "Corrected" : "Would correct"} ${changed} of ${books.length} book(s).`,
  );
}

async function main() {
  if (hasFlag("status")) {
    await printStatus();
    return;
  }

  if (hasFlag("fix-languages")) {
    // --dry-run reports without writing.
    await fixLanguages(!hasFlag("dry-run"));
    return;
  }

  const booksPath = argValue("books-path");
  const audiobooksPath = argValue("audiobooks-path");
  const googleKey = argValue("google-key");
  const enable = hasFlag("enable");
  const disable = hasFlag("disable");

  if (enable && disable) {
    console.error("--enable and --disable are mutually exclusive");
    process.exit(1);
  }

  if (booksPath || audiobooksPath) {
    await prisma.mediaSettings.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        ...(booksPath ? { booksLibraryPath: booksPath } : {}),
        ...(audiobooksPath ? { audiobooksLibraryPath: audiobooksPath } : {}),
      },
      update: {
        ...(booksPath ? { booksLibraryPath: booksPath } : {}),
        ...(audiobooksPath ? { audiobooksLibraryPath: audiobooksPath } : {}),
      },
    });
    if (booksPath) console.log(`Set books library path      → ${booksPath}`);
    if (audiobooksPath)
      console.log(`Set audiobooks library path → ${audiobooksPath}`);
  }

  if (googleKey) {
    // Encrypted with the app's own SECRET_KEY. Rotating SECRET_KEY invalidates
    // this row, and normalizeSecret then treats the integration as unconfigured
    // rather than sending ciphertext as an API key.
    const config = { api_key: encrypt(googleKey) };
    const existing = await prisma.integration.findFirst({
      where: { type: "googlebooks" },
      select: { id: true },
    });
    if (existing) {
      await prisma.integration.update({
        where: { id: existing.id },
        data: { enabled: true, config, updatedAt: new Date() },
      });
    } else {
      await prisma.integration.create({
        data: {
          type: "googlebooks",
          enabled: true,
          config,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    invalidateIntegrationConfigCache("googlebooks");
    console.log("Stored Google Books API key (encrypted) and enabled it");
  }

  if (enable || disable) {
    await prisma.appSettings.upsert({
      where: { id: 1 },
      create: { id: 1, booksEnabled: enable },
      update: { booksEnabled: enable },
    });
    console.log(`Set books_enabled → ${enable}`);
  }

  console.log("");
  await printStatus();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
