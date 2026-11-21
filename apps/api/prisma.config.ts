import { defineConfig } from "prisma/config";

// Only migrate/studio need a database; leaving the URL unset lets
// `prisma generate` (the postinstall) run on a fresh clone with no .env.
const url = process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  ...(url ? { datasource: { url } } : {}),
});
