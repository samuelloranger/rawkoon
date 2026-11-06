# Rawkoon — Paper Noir

One identity for the web app, iOS, Android TV, widgets and public documentation.

- Parchment #E6D8BF on charcoal #201F1C; raised #2C2B27; bronze #BDA586.
- Bricolage Grotesque 600 for the wordmark and display headings, optical size 72 and standard width.
- The raccoon is the icon. Square assets contain no lettering.
- Logo artwork is always light on a dark background. No dark-on-parchment, ivory-ground or reversed brand variants. Transparent marks are light and intended for dark surfaces.
- Preserve native controls and body typography; Literata remains for long ebook reading.

The outlined SVG files are the brand masters. fonts/ contains the original variable font, a pinned native semibold instance, a WOFF2 web face, and the SIL Open Font License.

Web/PWA PNGs are generated from apps/web/public/icon.svg by bun run --cwd apps/web generate-icons. The maskable icon uses a separate safe-area master. iOS app-icon PNGs are opaque and square so the platform applies its own mask. Android adaptive foregrounds retain transparency over the charcoal background.
