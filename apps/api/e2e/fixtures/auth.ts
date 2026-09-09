import type { FixtureRegistry } from "./types";

export const authFixtures: FixtureRegistry = {
  "GET /api/auth/accept-invitation": {
    phase: "read",
    skipReason:
      "No seeded invitation token; this route requires a real pending invitation token to exercise meaningfully.",
  },

  "POST /api/auth/accept-invitation": {
    phase: "action",
    skipReason:
      "No seeded invitation token; this route creates a user and needs a real pending invitation token.",
  },

  "GET /api/auth/me": { phase: "read", negativeBody: null },

  "GET /api/auth/setup-status": {
    phase: "read",
    public: true,
    negativeBody: null,
  },

  "GET /api/auth/sso-providers": {
    phase: "read",
    public: true,
    negativeBody: null,
  },

  // better-auth core routes (also appended by loadManifest). Exercised for
  // reachability; seed creds are the harness admin (admin@e2e.test).
  "GET /api/auth/get-session": {
    phase: "read",
    public: true,
    negativeBody: null,
  },
  // better-auth enforces a CSRF Origin header on these POSTs (403
  // MISSING_OR_NULL_ORIGIN) which the in-process dispatch doesn't send; a real
  // browser does. Out of scope per spec (better-auth internals); sign-in is
  // exercised for real by the seed's cookie acquisition every run.
  "POST /api/auth/sign-in/email": {
    phase: "read",
    public: true,
    skipReason:
      "better-auth CSRF requires an Origin header the harness dispatch omits; sign-in is exercised by seed",
  },
  "POST /api/auth/sign-up/email": {
    phase: "read",
    public: true,
    skipReason:
      "better-auth CSRF requires an Origin header the harness dispatch omits (better-auth internals, non-goal)",
  },

  // Mobile OAuth: 302-redirects through an external provider round-trip the
  // harness can't complete (no configured provider, no redirect following).
  "GET /api/mobile/oauth-start": {
    phase: "read",
    public: true,
    skipReason:
      "needs a configured OAuth provider + ASWebAuthenticationSession round-trip; 302 redirect flow",
  },
  "GET /api/mobile/auth-callback": {
    phase: "read",
    public: true,
    skipReason:
      "needs a completed OAuth provider round-trip (code/state); 302 redirect flow",
  },
};
