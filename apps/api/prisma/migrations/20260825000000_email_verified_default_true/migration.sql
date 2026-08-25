-- Rawkoon ships no email verification transport, so nothing ever flips
-- email_verified. A false default only served to block OIDC account linking
-- for the accounts it applied to (first sign-up, invitation accept).
--
-- Existing rows are deliberately left alone: the accountLinking config in
-- lib/auth.ts relaxes both halves of better-auth's gate, so already-created
-- users can link an OIDC provider without rewriting their rows.
ALTER TABLE "users" ALTER COLUMN "email_verified" SET DEFAULT true;
