import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { loadConfig } from "@rawkoon/api/config";

const adapter = new PrismaPg({ connectionString: loadConfig().DATABASE_URL });
export const prisma = new PrismaClient({ adapter });
