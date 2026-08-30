import { prisma } from "@rawkoon/api/db";
import { registerBookChapters } from "@rawkoon/api/services/books/registerBookChapters";
import { rescanBookEdition } from "@rawkoon/api/services/postProcessorBook";

function parseEditionId(arg: string | undefined): number | null {
  if (!arg) return null;
  const editionId = Number(arg);
  if (!Number.isInteger(editionId) || editionId <= 0) return null;
  return editionId;
}

async function main(): Promise<void> {
  const editionId = parseEditionId(process.argv[2]);
  if (editionId === null) {
    console.error(
      "Usage: bun src/scripts/registerEditionChapters.ts <editionId>",
    );
    process.exit(1);
  }

  console.log(`[register-edition-chapters] edition ${editionId}`);

  const rescan = await rescanBookEdition(editionId);
  console.log(
    "[register-edition-chapters] rescan:",
    JSON.stringify(rescan, null, 2),
  );
  if (rescan.error) {
    console.error(`[register-edition-chapters] ${rescan.error}`);
    process.exit(1);
  }

  const registration = await registerBookChapters(editionId);
  console.log(
    "[register-edition-chapters] register:",
    JSON.stringify(registration, null, 2),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
