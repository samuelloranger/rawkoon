---
name: Rawkoon
description: Cozy Dusk — a dark-only, lamp-lit media library for the homelab and the bedside.
colors:
  apricot: "#E8A06A"
  apricot-soft: "#F0BF93"
  terracotta: "#CF6A4E"
  terracotta-deep: "#AD5440"
  on-accent: "#2A1A10"
  surface-base: "#1C1715"
  surface-raised: "#241E1B"
  surface-inset: "#171311"
  surface-well: "#141010"
  border: "#322A25"
  border-strong: "#3A2F27"
  text-strong: "#F4ECE4"
  text: "#E3D8CF"
  text-muted: "#AA9A8C"
  text-faint: "#9D8775"
  seed: "#86B98A"
  importing: "#8FB6D6"
typography:
  display:
    fontFamily: "Fraunces Variable, Fraunces, Georgia, serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Fraunces Variable, Fraunces, Georgia, serif"
    fontSize: "2.125rem"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Fraunces Variable, Fraunces, Georgia, serif"
    fontSize: "1.0625rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Hanken Grotesk Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Fira Code, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "normal"
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  full: "9999px"
spacing:
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.terracotta}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "#DF8753"
    textColor: "{colors.on-accent}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-play:
    backgroundColor: "{colors.apricot}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.full}"
    size: "66px"
  input:
    backgroundColor: "{colors.surface-inset}"
    textColor: "{colors.text-strong}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  card:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "16px"
  badge:
    backgroundColor: "rgba(232, 160, 106, 0.12)"
    textColor: "{colors.apricot}"
    rounded: "{rounded.full}"
    padding: "4px 9px"
---

# Design System: Rawkoon

## Overview

**Creative North Star: "Cozy Dusk"**

Rawkoon is a dim room with one lamp. The ground is warm brown, almost wood, never cold gray. The lamp is apricot: rare, aimed, and the only thing that should feel lit. This is a late-night media library — queue-watching and audiobooks at the bedside — not a neon streaming app and not a chrome admin console.

Web and iPhone are one product. On iOS the structure is native (tabs, stacks, sheets, SF Symbols, SF Pro on every control). Brand lives in the ground, the serif, and Now Playing. On the web, Hanken Grotesk carries the tool UI and Fraunces still owns titles. Do not fork a second identity.

The system is dark-only. Light mode is not a variant; it is out of scope. Cool hues exist only as semantics (in-library, importing). They never become brand.

**Key Characteristics:**
- Dark-only warm brown surfaces (base / raised / inset / well)
- One lamp: apricot for play, focus, and the single active thing
- Terracotta for pressed, progress start, and the web primary button
- Fraunces for titles only; never body copy
- Native iOS structure, Rawkoon skin
- Semantic green and blue, never decorative

## Colors

A warm, low-chroma brown night with a single apricot lamp. Secondary cool hues are status, not identity.

### Primary
- **Apricot** (`apricot`): the lamp. Play, tint, focus ring, the one active control. Rarity is the point.
- **Apricot Soft** (`apricot-soft`): a quieter lamp — captions and secondary emphasis on Now Playing, never fills.
- **Terracotta** (`terracotta`): the ember. Pressed play, the start of a progress fill, and the web primary button fill.
- **Terracotta Deep** (`terracotta-deep`): pressed/deeper ember, poster placeholders.
- **On Accent** (`on-accent`): dark brown ink on apricot or terracotta. Never white on the lamp.

### Secondary
- **Seed** (`seed`): in-library and seeders. Sage, not brand green. A glanceable "already here."
- **Importing** (`importing`): inbound/renaming. Steel blue, same job as Seed — status only.

### Neutral
- **Surface Base** (`surface-base`): the room. App background, nav bars.
- **Surface Raised** (`surface-raised`): cards, rows, panels — one step closer to the lamp.
- **Surface Inset** (`surface-inset`): fields cut into the room.
- **Surface Well** (`surface-well`): grooves, tracks, unfilled progress, segmented-control wells.
- **Border / Border Strong** (`border`, `border-strong`): strokes. The 600-step brown in the CSS scale is borders only — never text.
- **Text Strong / Text / Muted / Faint**: parchment on wood, four steps. Muted still contrasts on raised surfaces; faint is the last readable step.

### Named Rules
**The One Lamp Rule.** Apricot is used on the one thing that is playing, focused, or the primary action. If a screen has more than one apricot fill, turn the extras down to terracotta, muted, or Seed.

**The Semantic Hue Rule.** Seed and Importing never paint chrome, buttons, or backgrounds. They label state. Brand stays warm.

**The Dark-Only Rule.** There is no light theme. Do not invert the brown into cream.

## Typography

**Display Font:** Fraunces (Georgia serif fallback)
**Body Font (web):** Hanken Grotesk (system sans fallback)
**Body Font (iOS):** SF Pro — San Francisco carries every control
**Label/Mono Font:** Fira Code on web; SF Pro / system monospaced on iOS
**Reading Font (web only):** Literata — long-form only. Fraunces tires at a few hundred words.

**Character:** A display serif that looks like a spine title, parked on a grotesque (web) or the system UI face (iPhone). Data — times, speeds, seeders, percents — stays monospaced so a list is scannable.

### Hierarchy
- **Display** (Fraunces, semibold, ~20px on Now Playing titles): the book in your hand, not a website H1.
- **Headline** (Fraunces, semibold, 34px iOS large titles): top-level screens only.
- **Title** (Fraunces, semibold, 17px inline nav / section titles).
- **Body** (Hanken / SF Pro, regular, 14–17px): all copy that is not a title.
- **Label** (mono, medium, 11–13px): badges, times, ETAs, chapter remaining.

### Named Rules
**The Display-Only Serif Rule.** Fraunces is titles, headers, and Now Playing. Never body, never buttons, never badges.

**The Native Type Rule.** On iOS, body and controls stay on SF Pro and follow Dynamic Type. Hard-coded point sizes are a last resort for display moments, not a layout strategy.

## Layout

Web is a dense homelab tool: inset lists, poster grids, a 945px `mobile-max` breakpoint. iOS is four tabs (Discover, Library, Activity, Settings) plus a glass mini-player above the tab bar; Now Playing is a large sheet. Safe-area insets are real on both (PWA `viewport-fit=cover` and native).

Rhythm is 8 / 12 / 16 / 24. Poster cards are 2:3. Touch targets on iOS are 44pt minimum. Edge-swipe back stays alive; do not overlay it.

Do not invent a fifth tab or a custom global nav on iOS. Sections, not actions, live in the tab bar.

## Elevation & Depth

Hybrid. Everyday chrome is tonal: base, raised, inset, well — wood steps, not drop shadows. Objects that should feel held (cover art, Now Playing) cast a real warm shadow. Web dialogs may use a heavy shadow (`shadow-2xl`) to lift a modal off the room; lists do not.

### Shadow Vocabulary
- **Cover float** (`0 14px 24px rgba(0,0,0,0.6)` on iOS Now Playing): the book in lamplight.
- **Mini-player** (`0 4px 10px rgba(0,0,0,0.4)`): a small object above the tab bar.
- **Focus ring** (2px surface-base gap, then 4px apricot): the only outline. Defined once; every field uses it.

### Named Rules
**The Flat-By-Default Rule.** Rows, settings, and grids stay flat. Shadows are for objects (covers, the playing sheet), not for every card.

## Shapes

Soft rectangles, not squircles-as-brand. Web: 8px (`rounded-lg`) on buttons and fields, 12px (`rounded-xl`) on panels, full capsules on badges and progress. iOS: ~10px on covers, ~16–18px on Now Playing cover and mini-player, capsules on sleep/rate chips and StatusBadge.

Hairline warm borders (`border` / `border-strong`), not thick frames. Book covers get a dark spine strip on the left so a placeholder still reads as a book.

## Components

Native structure, Rawkoon skin. Spend boldness on apricot, Fraunces, and Now Playing — not on reinvented controls.

### Buttons
- **Shape:** gently rounded (8px web; iOS play is a circle).
- **Primary (web):** terracotta fill, on-accent ink, 40px tall, 8px radius. Hover shifts toward apricot (`#DF8753`).
- **Play (iOS):** apricot fill, on-accent glyph, 66px circle with a soft apricot glow. Pressed goes terracotta.
- **Ghost / outline:** raised or transparent, parchment text, warm border. No gray system buttons on branded screens.
- **Focus:** the shared apricot ring, never a browser outline.

### Chips
- **StatusBadge:** capsule, 12% tint wash, 30% tint stroke, monospaced caption. Tint is apricot (active), Seed (present), Importing (inbound), muted otherwise.
- **iOS rate/sleep menus:** capsule, raised fill, strong border; apricot stroke when the sleep timer is live.

### Cards / Containers
- **Corner Style:** 12px web panels; 10–16px iOS covers.
- **Background:** raised for cards, base for the page, well for tracks.
- **Shadow Strategy:** none at rest on lists; cover-float on Now Playing.
- **Border:** 1px `border`, optional 6% white hairline on covers.
- **Internal Padding:** 16px typical; 24px on Now Playing.

### Inputs / Fields
- **Style:** inset well, 8px radius, parchment text, warm border.
- **Focus:** `focus-ring` (surface gap + apricot).
- **iOS segmented controls:** well background, apricot selected segment, on-accent selected label.

### Navigation
- **iOS:** system TabView and NavigationStack. Opaque dusk nav bars, Fraunces large titles, apricot tint. Mini-player is an inset glass bar, not a fifth tab.
- **Web:** tool chrome on base; sticky bars use the z-index scale (nav 50, modal 200). Active nav is apricot or terracotta, never Seed.

### Book Cover (signature)
A square or 2:3 poster with a 5% black spine on the left edge, 10px corners, optional 6% white hairline. Placeholder is terracotta-deep → apricot. This is how a title reads as a book even without art.

### Dusk Progress (signature)
A 5px well capsule; fill is terracotta → apricot, left to right. Never a system blue bar.

## Do's and Don'ts

### Do:
- **Do** keep web and iPhone on the same brown room and the same apricot lamp.
- **Do** use Fraunces for titles and SF Pro / Hanken for everything you tap.
- **Do** put Seed and Importing on status only.
- **Do** use the shared focus ring; do not invent a second outline.
- **Do** let iOS be iOS: tabs, sheets, swipe actions, SF Symbols.

### Don't:
- **Don't** introduce light mode, cold gray, or Plex-style neon.
- **Don't** set body copy in Fraunces.
- **Don't** put white type on apricot.
- **Don't** use the CSS neutral-600 brown for text (borders only).
- **Don't** rebuild navigation, back gestures, or tab bars as a website.
- **Don't** paint chores, habits, or household-event chrome — those surfaces are out of the product.
