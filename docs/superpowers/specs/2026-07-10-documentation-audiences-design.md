# Documentation audience paths

## Goal

Make the VitePress site easy to navigate by separating everyday media use,
self-hosted instance administration, and contributor material.

## Information architecture

The site has three audience paths:

1. **Use Rawkoon** contains the first-media workflow and the library guides:
   quality profiles, metadata, downloads, and files.
2. **Self-host Rawkoon** contains installation, first administrator
   configuration, integrations, deployment, and recovery.
3. **Development** contains architecture, project decisions, contributing,
   and the web API-client conventions.

The top navigation links directly to one entry page for each path. The
sidebar uses the same three groups, so a reader never has to infer whether a
page is for operating an instance or changing Rawkoon itself.

## Content changes

Create `docs/self-hosting.md` from the installation and administrator setup
material currently in `docs/getting-started.md`: prerequisites, production
stack, environment values, library paths, and required integrations. Link to
the existing integrations and deployment guides instead of duplicating them.

Keep `docs/getting-started.md` at its existing URL, but make it a user guide
for an already-running instance: adding a title, selecting a quality profile,
grabbing a release, and tracking its completion. Remove Docker commands and
the local-development section.

Keep the current library, self-hosting, and development pages at their URLs.
Only their navigation groups and cross-links change. The home page offers
"Install Rawkoon" and "Use Rawkoon" actions; GitHub remains available from
the social link.

Update the root README's documentation links so installation and use are
distinct there too.

## Constraints and verification

No dependencies, custom theme components, redirects, or new documentation
frameworks are needed. Developer material remains available but is not mixed
into the user or self-hosting reading path.

Build the site with local and GitHub Pages base paths, then request the three
entry pages and each existing documentation route from the LAN preview.
