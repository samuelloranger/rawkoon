import { z } from "zod/v4";

const commaSeparatedEmails = z
  .string()
  .optional()
  .default("")
  .transform((v) =>
    v
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean),
  );

const booleanString = z
  .string()
  .optional()
  .default("false")
  .transform((v) => v.toLowerCase() === "true");

const portNumber = z.coerce.number().int().min(1).max(65535);
const githubRepoFullName = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
  .optional()
  .default("samuelloranger/rawkoon");

// DATABASE_URL is required in real runtimes but left optional under `bun test`
// (NODE_ENV=test): the unit suite mocks `@rawkoon/api/db` and never sets
// DATABASE_URL, while integration tests detect a real DB via process.env.DATABASE_URL.
const databaseUrl =
  process.env.NODE_ENV === "test"
    ? z.string().optional().default("")
    : z
        .string()
        .min(1, "DATABASE_URL is required")
        .refine(
          (v) => v.startsWith("postgresql://") || v.startsWith("postgres://"),
          "DATABASE_URL must be a postgresql:// connection string",
        );

const envSchema = z.object({
  // ── Core ──────────────────────────────────────────────
  NODE_ENV: z.string().optional().default("development"),
  API_PORT: portNumber.optional().default(3000),
  SECRET_KEY: z
    .string()
    .min(32, "SECRET_KEY must be at least 32 characters")
    .refine(
      (val) => val !== "generate-a-random-secret-here",
      "SECRET_KEY cannot be the default placeholder",
    ),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "BETTER_AUTH_SECRET must be at least 32 characters")
    .refine(
      (val) => val !== "generate-a-random-secret-here",
      "BETTER_AUTH_SECRET cannot be the default placeholder",
    )
    .optional()
    .or(z.literal("")),
  WEBAUTHN_RP_ID: z.string().optional(),
  WEBAUTHN_RP_NAME: z.string().optional().default("Rawkoon"),
  WEBAUTHN_ORIGIN: z.string().optional(),
  BASE_URL: z.url().optional().default("http://localhost:3000"),
  CORS_ORIGIN: z.string().optional().default("http://localhost:5173"),
  SERVE_STATIC: booleanString,
  LOG_LEVEL: z.string().optional().default("info"),
  TZ: z.string().optional().default("America/New_York"),

  // ── Database ──────────────────────────────────────────
  DATABASE_URL: databaseUrl,

  // ── Redis ─────────────────────────────────────────────
  REDIS_URL: z.string().optional(),
  REDIS_HOST: z.string().optional().default("redis"),
  REDIS_PORT: portNumber.optional().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().int().min(0).optional().default(0),

  // ── Image Storage ─────────────────────────────────────
  IMAGE_STORAGE_DIR: z.string().optional().default("./data/images"),

  // ── Access Control ────────────────────────────────────
  ALLOWED_EMAILS: commaSeparatedEmails,
  ADMIN_EMAILS: commaSeparatedEmails,

  // ── Web Push (VAPID) ──────────────────────────────────
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_CONTACT_EMAIL: z.string().optional().default("mailto:admin@localhost"),

  // ── GitHub Releases ───────────────────────────────────
  GITHUB_RELEASES_REPO: githubRepoFullName,
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/** Reset cached config — for tests only. */
export function resetConfig(): void {
  cached = null;
}

export function loadConfig(): Env {
  if (cached) return cached;

  const raw = { ...process.env };
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    console.error(`\n❌ Environment validation failed:\n${issues}\n`);
    process.exit(1);
  }

  cached = result.data;
  return cached;
}

// ── Derived helpers ───────────────────────────────────────────────────────────

export function getBaseUrl(): string {
  return loadConfig().BASE_URL;
}

export function getRedisUrl(): string {
  const env = loadConfig();
  if (env.REDIS_URL) return env.REDIS_URL;
  if (env.REDIS_PASSWORD) {
    return `redis://:${encodeURIComponent(env.REDIS_PASSWORD)}@${env.REDIS_HOST}:${env.REDIS_PORT}/${env.REDIS_DB}`;
  }
  return `redis://${env.REDIS_HOST}:${env.REDIS_PORT}/${env.REDIS_DB}`;
}

export function getWebAuthnConfig(): {
  rpID: string;
  rpName: string;
  origin: string;
} {
  const config = loadConfig();
  const baseUrl = config.BASE_URL;
  const parsedBase = new URL(baseUrl);

  return {
    rpID: config.WEBAUTHN_RP_ID ?? parsedBase.hostname,
    rpName: config.WEBAUTHN_RP_NAME,
    origin: config.WEBAUTHN_ORIGIN ?? baseUrl,
  };
}
