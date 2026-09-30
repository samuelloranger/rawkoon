# iOS HIG fixes — design

Date: 2026-09-30 · Status: from the simulator review, pending plan review

## Goal

Fix the Apple Human Interface Guidelines failures found on the iPhone 17 Pro
simulator (iOS 26) and in `apps/ios`. Success means the login wordmark stays
one word at the largest accessibility text size, a disabled Sign In button
looks disabled, Password AutoFill can pair the email and password fields,
each icon-only tab can show its name in the large content viewer, and the
book-source reorder buttons have spoken names.

## In scope

- Login lockup on phone and Mac: side by side when it fits, stacked when it
  does not, and the word "Rawkoon" never breaks mid-word.
- Phone Sign In uses the same disabled treatment as the Mac card (60% opacity
  on the apricot fill, not only on the label).
- Mac login fields are 44pt tall.
- Email uses `.textContentType(.username)`, password keeps `.password`, and
  Return moves through the fields and submits when they are filled.
- Each visible tab slot gets `accessibilityShowsLargeContentViewer` showing
  that tab's existing localized name.
- Book source reorder chevrons are labeled "Move up" and "Move down", with
  French strings in `Rawkoon/Localizable.xcstrings`.

## Out of scope

- Light mode, and any retinting for Increase Contrast. Dark-only is a product
  choice (`preferredColorScheme(.dark)` in `RawkoonApp.swift`, explained in
  `project.yml`).
- Replacing the seven icon-only tabs with a system tab bar, adding visible
  text labels under the icons, or changing tab order. The custom bar stays.
- iPad layout and landscape. The app stays iPhone, portrait-only.
- New dependencies, deployment-target changes, and any server or web change.
