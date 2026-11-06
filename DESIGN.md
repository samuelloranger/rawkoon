---
name: Rawkoon
description: Paper Noir — parchment, charcoal and a raccoon across every Rawkoon app.
colors:
  parchment: "#E6D8BF"
  parchment-soft: "#F2EADC"
  bronze: "#BDA586"
  bronze-deep: "#A78D70"
  on-accent: "#25221C"
  surface-base: "#201F1C"
  surface-raised: "#2C2B27"
  surface-inset: "#171714"
  surface-well: "#141411"
  border: "#4C4941"
  border-strong: "#5A554C"
  text-strong: "#F3EEE5"
  text: "#DDD7CC"
  text-muted: "#B6AD9E"
  text-faint: "#B0A695"
  seed: "#A8BBA0"
  importing: "#A7B9CC"
  danger: "#DF9B91"
typography:
  display:
    fontFamily: "Bricolage Grotesque, ui-sans-serif, system-ui, sans-serif"
    fontWeight: 600
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Hanken Grotesk Variable, ui-sans-serif, system-ui, sans-serif"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Fira Code, ui-monospace, monospace"
  reading:
    fontFamily: "Literata Variable, ui-serif, Georgia, serif"
---

# Paper Noir

Rawkoon is a personal library for watching, reading and listening. Its identity is a parchment raccoon on charcoal, with Bricolage Grotesque display lettering and restrained bronze accents. Apply this identity to web, iOS, widgets, Android TV and documentation without changing their native navigation or controls.

## Brand assets

The source of truth is assets/brand/. Square icons contain only the raccoon. Horizontal and landscape marks pair the raccoon with the outlined Bricolage wordmark. All brand artwork is light on dark. Never create a dark-on-parchment, ivory-background or reversed logo variant. Transparent light marks belong on dark backgrounds. App icons have a charcoal ground; default and dark appearances use the same identity.

## Surfaces and roles

The app is dark-only. Charcoal is the base, the raised surface supports cards and sheets, and insets support fields. Parchment marks the main action and active control. Bronze is for secondary emphasis and progress. Keep success, import and error colors semantic; do not recolor every status into the brand accent.

The existing iOS token names apricot and terracotta map to parchment and bronze for compatibility with existing call sites. Their names are implementation details, not alternate palettes.

## Typography

Use Bricolage Grotesque 600 for display titles, navigation titles and brand lettering. The web uses the self-hosted variable face; native apps use a pinned semibold instance at optical size 72 and standard width. Keep body text in the incumbent Hanken Grotesk (web/TV) or platform-native face (iOS). Literata remains the long-reading face. Preserve Dynamic Type and system navigation affordances.

## Native behavior

The phone stays dark via preferredColorScheme at its SwiftUI root. Do not force UIUserInterfaceStyle in Info.plist: CarPlay must retain the car's own day/night appearance. The brand prohibition concerns the logo; CarPlay's system-owned presentation remains native and readable.

TV keeps D-pad focus rings, overscan margins and the existing performance model. The launcher banner, adaptive icon and navigation brand all use the same flat parchment raccoon and Bricolage lettering.

## Verification

Check text and icon contrast, focus visibility, font loading, icon safe areas and logo legibility at small sizes. Verify real web/mobile and native simulator screens. No fabricated usage figures, quotes or content.
