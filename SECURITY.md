# Security Policy

## Supported versions

Rawkoon is early-stage software. Security fixes are applied to the latest
release only. Please run the most recent version before reporting an issue.

## Reporting a vulnerability

**Do not open a public issue for security vulnerabilities.**

Report privately through GitHub's
[private vulnerability reporting](https://github.com/samuelloranger/rawkoon/security/advisories/new).
This creates a confidential advisory visible only to the maintainers.

Please include:

- A description of the vulnerability and its impact.
- Steps to reproduce (proof of concept if possible).
- Affected version(s) and configuration.

## What to expect

- Acknowledgement of your report within 7 days.
- An initial assessment and severity classification.
- A fix and coordinated disclosure once a patch is available. Credit will be
  given to reporters who wish to be named.

## Scope

Rawkoon handles secrets (`SECRET_KEY`, `BETTER_AUTH_SECRET`), indexer
credentials, and download-client access. Reports touching authentication,
secret handling, SSRF via indexer/TMDB requests, or path traversal in the
library scanner are especially valued.
