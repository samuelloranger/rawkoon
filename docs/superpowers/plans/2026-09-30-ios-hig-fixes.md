# iOS HIG Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the login, Password AutoFill, tab-bar, and reorder-button issues from the 2026-09-30 iOS standards review without changing the dark theme or the seven-tab bar.

**Architecture:** All of the work is in the SwiftUI app target. The login phone form and the Mac card share one lockup that uses `ViewThatFits`: a rigid side-by-side row when the unscaled title fits, otherwise a stack whose title scales down just enough to stay one line. Disabled Sign In dims the apricot fill itself. Tab names in the large content viewer reuse `RootTab.title`. New VoiceOver strings go through `Text` so `scripts/check-l10n.py` sees them.

**Tech Stack:** SwiftUI, iOS 26.2 deployment target, Swift 6 strict concurrency, XcodeGen, Swift Testing is unused here (these are view changes), `scripts/check-l10n.py` on Linux, simulator screenshots on `macbuild`.

**Spec:** `docs/superpowers/specs/2026-09-30-ios-hig-fixes-design.md`

## Global Constraints

- Dark-only stays: do not remove `.preferredColorScheme(.dark)` and do not add a light palette.
- The iPhone bar stays seven icon-only tabs, in `RootTab.phone` order, avatar on Settings. Do not add visible labels under the icons.
- iPhone-only, portrait-only. Do not change `TARGETED_DEVICE_FAMILY` or `UISupportedInterfaceOrientations`.
- No new third-party dependencies. No `project.yml` changes.
- Every new user-facing literal passed to `Text`, `Button`, `Label`, or `LocalizedStringKey` is added to `apps/ios/Rawkoon/Localizable.xcstrings` with a French translation, or `python3 apps/ios/scripts/check-l10n.py` fails.
- Comments: one short line, and only where the reason is not obvious.
- `macbuild` is the only real iOS gate. Linux can run `check-l10n.py` only. Never `git pull` in `macbuild:~/rawkoon` or `~/Sites/projets_perso/rawkoon` (those trees have diverged). Sync a clean copy:

```bash
ssh macbuild 'mkdir -p ~/build/rawkoon-hig/apps'
rsync -a --delete \
  --exclude '.build' --exclude 'Rawkoon.xcodeproj' --exclude '.swiftpm' \
  apps/ios/ macbuild:~/build/rawkoon-hig/apps/ios/
rsync -a apps/shared/contracts/ macbuild:~/build/rawkoon-hig/apps/shared/contracts/
```

Build and install (Debug, so the screenshot harness exists):

```bash
ssh macbuild 'export PATH=/opt/homebrew/bin:$PATH
cd ~/build/rawkoon-hig/apps/ios
xcodegen generate
xcodebuild -project Rawkoon.xcodeproj -scheme Rawkoon \
  -destination "platform=iOS Simulator,name=iPhone 17 Pro" \
  -configuration Debug CODE_SIGNING_ALLOWED=NO build
APP=$(find ~/Library/Developer/Xcode/DerivedData -path "*rawkoon-hig*" -name Rawkoon.app -path "*Debug-iphonesimulator*" | head -1)
xcrun simctl install booted "$APP"'
```

If `iPhone 17 Pro` is missing, pick a booted iPhone from `xcrun simctl list devices available`. Launch login with no `RAWKOON_SERVER`, `RAWKOON_EMAIL`, `RAWKOON_PASSWORD`, or `RAWKOON_TOKEN` — a simulator build has no keychain entitlement, so it starts logged out (`AppModel.debugAutologinIfNeeded`).

## Review Focus

- **Accessibility XXXL on a 402pt-wide phone** must keep "Rawkoon" on one line, with the logo above or beside the word, never between "Rawk" and "oon". Covered by Task 1's screenshot.
- **Empty email, password, or server** must dim the apricot Sign In fill. **Loading with all three filled** must keep that fill at full opacity so the spinner stays visible. Covered by Task 2.
- **Return on an empty password** must not call `login`. **Return on a filled password** must. Covered by Task 3.
- **The Settings slot** shows an avatar, so its large content viewer must still say "Settings" (gear icon in the viewer only). Covered by Task 4.
- **The first source's Move up button** is disabled and must still expose the "Move up" label. Covered by Task 5.

---

### Task 1: Login wordmark stays one line

**Files:**
- Modify: `apps/ios/Rawkoon/Views/LoginView.swift` (phone header around the `HStack` at line 197, Mac header around line 48, `fieldRow` height at line 125)

**Interfaces:**
- Consumes: `Font.display(_:weight:)`, `Image("AppLogo")`, `Theme.textStrong`
- Produces: `loginLockup(titleSize:logoSide:)` on `LoginView`, used by both `phoneForm` and `macLayout`

- [ ] **Step 1: Confirm the failure this task removes**

The phone header is a fixed `HStack` of a 52×52 logo and `.display(40)`. On the iPhone 17 Pro simulator at `accessibility-extra-extra-extra-large`, that row draws "Rawk", the logo, then "oon", and the password row is cut mid-glyph. Do not re-test yet if that screenshot is still the current code. The Mac header is the same shape at 64pt / `.display(34)` inside a 380pt card. `fieldRow` is `frame(height: 42)`.

- [ ] **Step 2: Add one lockup both layouts use**

The horizontal child must not shrink. If it has `minimumScaleFactor`, `ViewThatFits` treats it as fitting and the huge title stays beside the logo, unreadably small. `fixedSize` makes the horizontal child as wide as the unscaled word, so it is rejected when the row is narrower than logo + word, and the vertical child is chosen.

Add both functions to `LoginView`:

```swift
private func loginLockup(titleSize: CGFloat, logoSide: CGFloat) -> some View {
    ViewThatFits(in: .horizontal) {
        lockup(titleSize: titleSize, logoSide: logoSide, stacked: false)
        lockup(titleSize: titleSize, logoSide: logoSide, stacked: true)
    }
}

@ViewBuilder
private func lockup(titleSize: CGFloat, logoSide: CGFloat, stacked: Bool) -> some View {
    let logo = Image("AppLogo")
        .resizable()
        .frame(width: logoSide, height: logoSide)
        .clipShape(RoundedRectangle(cornerRadius: logoSide * 0.25, style: .continuous))
    let title = Text("Rawkoon")
        .font(.display(titleSize, weight: .semibold))
        .foregroundStyle(Theme.textStrong)
        .lineLimit(1)
    if stacked {
        VStack(spacing: 8) {
            logo
            title.minimumScaleFactor(0.4)
        }
    } else {
        HStack(spacing: 14) {
            logo
            title.fixedSize()
        }
    }
}
```

Replace the phone header `HStack` (logo 52, `.display(40)`) with:

```swift
loginLockup(titleSize: 40, logoSide: 52)
    .padding(.vertical, 10)
    .listRowBackground(Color.clear)
```

Replace the Mac header `VStack` (logo 64, `.display(34)`, subtitle "Sign in to your library") with:

```swift
VStack(spacing: 14) {
    loginLockup(titleSize: 34, logoSide: 64)
    Text("Sign in to your library")
        .font(.subheadline)
        .foregroundStyle(Theme.muted)
}
```

In `fieldRow`, change `.frame(height: 42)` to `.frame(height: 44)`. That helper is the Mac card only. Phone fields are form rows and already clear 44pt.

- [ ] **Step 3: Screenshot on macbuild**

Sync, build, and install with the global commands. Then:

```bash
ssh macbuild 'export PATH=/opt/homebrew/bin:$PATH
UDID=$(xcrun simctl list devices | grep "iPhone 17 Pro" | grep Booted | head -1 | sed -E "s/.*\(([A-F0-9-]+)\).*/\1/")
xcrun simctl terminate "$UDID" cloud.samlo.rawkoon || true
xcrun simctl ui "$UDID" content_size medium
xcrun simctl launch "$UDID" cloud.samlo.rawkoon
sleep 2
xcrun simctl io "$UDID" screenshot /tmp/hig-login-medium.png
xcrun simctl ui "$UDID" content_size accessibility-extra-extra-extra-large
sleep 1
xcrun simctl io "$UDID" screenshot /tmp/hig-login-ax.png
xcrun simctl ui "$UDID" content_size medium'
```

Expected, medium: logo and "Rawkoon" still sit on one row, same as today. Expected, AX: "Rawkoon" is a single line, the logo is above it, and the password row is not split through the middle of the glyphs. Sign In may sit below the fold; the form must scroll to it. Copy the PNGs back with `scp` and look at them.

- [ ] **Step 4: Commit**

```bash
git add apps/ios/Rawkoon/Views/LoginView.swift
git commit -m "$(cat <<'EOF'
Keep the login wordmark on one line when text is huge.

EOF
)"
```

### Task 2: Dim Sign In when the fields are empty

**Files:**
- Modify: `apps/ios/Rawkoon/Views/LoginView.swift` (`signInButton` around line 131, phone Sign In section around line 252)

**Interfaces:**
- Consumes: `model.login(server:email:password:)`, `model.loading`, `model.serverURL`
- Produces: `fieldsReady` on `LoginView`. Task 3 calls it from `onSubmit`.

- [ ] **Step 1: Write the shared ready check**

The Mac button already sets `.opacity(... ? 0.6 : 1)` on a button whose label paints the apricot fill. The phone button sets `.listRowBackground(Theme.apricot)` outside the button, so `.disabled` leaves a solid apricot row. That is what the default-size launch screenshot showed: empty fields, full apricot Sign In.

Add:

```swift
private var fieldsReady: Bool {
    !email.isEmpty && !password.isEmpty && !model.serverURL.isEmpty
}
```

- [ ] **Step 2: Use it in both buttons**

Replace the duplicated empty-checks.

Mac `signInButton`: `.disabled(model.loading || !fieldsReady)` and `.opacity(fieldsReady ? 1 : 0.6)`.

Phone section: draw the fill inside the label, clear the row background, and put opacity on the button so the fill dims too.

```swift
Section {
    Button {
        Task { await model.login(server: model.serverURL, email: email, password: password) }
    } label: {
        Group {
            if model.loading {
                ProgressView().tint(Theme.onAccent)
            } else {
                Text("Sign In").fontWeight(.semibold)
            }
        }
        .frame(maxWidth: .infinity)
        .frame(minHeight: 44)
        .foregroundStyle(Theme.onAccent)
        .background(Theme.apricot, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
    .buttonStyle(.plain)
    .disabled(model.loading || !fieldsReady)
    .opacity(fieldsReady ? 1 : 0.6)
    .listRowBackground(Color.clear)
}
```

Opacity depends on `fieldsReady`, not on `loading`. A tap that has already started must keep a full-strength spinner.

- [ ] **Step 3: Screenshot the empty form**

Relaunch at `content_size medium` with empty fields. Expected: Sign In is visibly faded apricot, not the solid button from the review screenshot. Do not spend a shot on the loading state; the guard is the `fieldsReady` expression above.

- [ ] **Step 4: Commit**

```bash
git add apps/ios/Rawkoon/Views/LoginView.swift
git commit -m "$(cat <<'EOF'
Dim Sign In on iPhone until the login fields are filled.

EOF
)"
```

### Task 3: Password AutoFill and Return

**Files:**
- Modify: `apps/ios/Rawkoon/Views/LoginView.swift` (both email fields, both password fields, both server fields)

**Interfaces:**
- Consumes: `fieldsReady` from Task 2, `model.login(server:email:password:)`
- Produces: nothing later tasks use

- [ ] **Step 1: Add focus and a submit that no-ops when empty**

```swift
private enum LoginField: Hashable {
    case server, email, password
}

@FocusState private var loginFocus: LoginField?

private func submit(_ model: AppModel) {
    guard fieldsReady, !model.loading else { return }
    Task { await model.login(server: model.serverURL, email: email, password: password) }
}
```

`fieldsReady` is the Task 2 property. Return on an empty password hits the `guard` and does not call `login`.

- [ ] **Step 2: Attach the content types on both layouts**

Phone server field (it already has `.keyboardType(.URL)`): add `.textContentType(.URL)`, `.focused($loginFocus, equals: .server)`, `.submitLabel(.next)`, `.onSubmit { loginFocus = .email }`.

Mac server field: add the same four, plus `.keyboardType(.URL)` which it lacks today.

Both email fields: `.textContentType(.username)`, `.keyboardType(.emailAddress)`, `.textInputAutocapitalization(.never)`, `.autocorrectionDisabled()`, `.focused($loginFocus, equals: .email)`, `.submitLabel(.next)`, `.onSubmit { loginFocus = .password }`.

Phone already has the email keyboard. Mac email does not — add `.keyboardType(.emailAddress)` there too.

Both password fields: keep `.textContentType(.password)`. Add `.focused($loginFocus, equals: .password)`, `.submitLabel(.go)`, `.onSubmit { submit(model) }`.

`.username` is the content type Password AutoFill pairs with `.password`. `.emailAddress` as the content type does not form that pair, so the email field must not use it. The email keyboard stays.

Point the Mac and phone Sign In buttons at `submit(model)` instead of inlining `Task { await model.login(...) }`.

- [ ] **Step 3: Check the modifiers are present**

```bash
grep -n "textContentType(.username)" apps/ios/Rawkoon/Views/LoginView.swift
grep -n "submitLabel(.go)" apps/ios/Rawkoon/Views/LoginView.swift
grep -n "guard fieldsReady, !model.loading" apps/ios/Rawkoon/Views/LoginView.swift
```

Expected: two `.username` hits (phone and Mac), two `.go` hits, and one `guard fieldsReady` hit. That guard is what keeps Return on an empty password from calling `login`.

- [ ] **Step 4: Commit**

```bash
git add apps/ios/Rawkoon/Views/LoginView.swift
git commit -m "$(cat <<'EOF'
Let iOS pair the login email with the password and submit from Return.

EOF
)"
```

### Task 4: Large content viewer on the tab bar

**Files:**
- Modify: `apps/ios/Rawkoon/Views/TabBar/RawkoonTabBar.swift` (`slot`, the button that already sets `.accessibilityLabel(Text(tab.title))` around line 74)

**Interfaces:**
- Consumes: `RootTab.title` (`LocalizedStringKey`), `RootTab.symbol` in `RootTab+Display.swift`
- Produces: nothing

- [ ] **Step 1: Add the viewer on the slot button**

Apple's modifier is `accessibilityShowsLargeContentViewer { }`. It shows on long-press when a control has to stay small. The bar is icon-only on purpose, so this is the name people get without VoiceOver. Do not add a custom long-press gesture; it would fight the system viewer.

On the `Button` in `slot`, after `.accessibilityLabel(Text(tab.title))`:

```swift
.accessibilityShowsLargeContentViewer {
    Label(tab.title, systemImage: tab == .settings ? "gearshape" : tab.symbol)
}
```

Settings paints an avatar, not `gearshape`. The viewer still needs an icon, and `gearshape` matches `RootTab.symbol` for that case. Tab titles ("Home", "Media", "Books", "Discover", "Explore", "Notifications", "Settings") are already in the string catalog. No new strings.

Collapsed slots are already `.accessibilityHidden` when folded, so a hidden tab does not show a viewer.

- [ ] **Step 2: Screenshot the bar so the icons did not move**

```bash
ssh macbuild 'export PATH=/opt/homebrew/bin:$PATH
UDID=$(xcrun simctl list devices | grep "iPhone 17 Pro" | grep Booted | head -1 | sed -E "s/.*\(([A-F0-9-]+)\).*/\1/")
xcrun simctl terminate "$UDID" cloud.samlo.rawkoon || true
xcrun simctl ui "$UDID" content_size medium
SIMCTL_CHILD_RAWKOON_SCREEN=tabBar xcrun simctl launch "$UDID" cloud.samlo.rawkoon
sleep 2
xcrun simctl io "$UDID" screenshot /tmp/hig-tabbar.png'
```

Expected: three bars (expanded with a badge, expanded with "9+" and no initials, collapsed). Same layout as before this task. `RAWKOON_SCREEN=tabBar` is compiled only in Debug (`DebugScreens.swift`).

Long-press is not in this screenshot. After the shot, long-press the Home slot and the avatar slot on the simulator (Xcode MCP `DeviceInteractionSynthesize` once the agent is approved, or by hand). Expected: a large "Home" and a large "Settings".

- [ ] **Step 3: Commit**

```bash
git add apps/ios/Rawkoon/Views/TabBar/RawkoonTabBar.swift
git commit -m "$(cat <<'EOF'
Show each tab name in the large content viewer.

EOF
)"
```

### Task 5: Name the book-source reorder buttons

**Files:**
- Modify: `apps/ios/Rawkoon/Views/Settings/books/BooksSettingsView.swift` (chevron buttons around lines 87–90)
- Modify: `apps/ios/Rawkoon/Localizable.xcstrings` (insert before the `"Movies"` key)

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: catalog keys `Move up` and `Move down`

- [ ] **Step 1: Run the l10n check before the strings exist**

Add the labels first, without the catalog entries:

```swift
Button { move(index, by: -1) } label: { Image(systemName: "chevron.up") }
    .disabled(index == 0)
    .buttonStyle(.borderless)
    .accessibilityLabel(Text("Move up"))
Button { move(index, by: 1) } label: { Image(systemName: "chevron.down") }
    .disabled(index == order.count - 1)
    .buttonStyle(.borderless)
    .accessibilityLabel(Text("Move down"))
```

`Text("…")` is what `scripts/check-l10n.py` matches. `accessibilityLabel("Move up")` as a bare string is not, so the `Text` wrapper is required. `.disabled` on the first row must stay; a disabled control still needs the label.

```bash
python3 apps/ios/scripts/check-l10n.py
```

Expected: FAIL, mentioning `Move up` and `Move down`.

- [ ] **Step 2: Add the French strings**

Insert these two objects into `apps/ios/Rawkoon/Localizable.xcstrings` immediately before `"Movies"`. Match the surrounding comma style.

```json
"Move down": {
  "localizations": {
    "fr": {
      "stringUnit": {
        "state": "translated",
        "value": "Déplacer vers le bas"
      }
    }
  }
},
"Move up": {
  "localizations": {
    "fr": {
      "stringUnit": {
        "state": "translated",
        "value": "Déplacer vers le haut"
      }
    }
  }
},
```

- [ ] **Step 3: Run the l10n check again**

```bash
python3 apps/ios/scripts/check-l10n.py
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/ios/Rawkoon/Views/Settings/books/BooksSettingsView.swift apps/ios/Rawkoon/Localizable.xcstrings
git commit -m "$(cat <<'EOF'
Give the book source reorder buttons spoken names.

EOF
)"
```

### Task 6: macbuild gate

**Files:**
- No source edits unless a screenshot from Tasks 1–4 shows a regression. Fix that regression in the task that owns it, then re-run this task.

- [ ] **Step 1: Lint and l10n**

On Linux:

```bash
python3 apps/ios/scripts/check-l10n.py
```

On macbuild, from `~/build/rawkoon-hig/apps/ios` after the sync in Global Constraints:

```bash
ssh macbuild 'export PATH=/opt/homebrew/bin:$PATH
cd ~/build/rawkoon-hig/apps/ios
swiftformat Rawkoon RawkoonTests Sources Tests --lint
swiftlint lint'
```

Expected: `check-l10n.py` exit 0, swiftformat reports no files, swiftlint reports no violations. If swiftformat would rewrite `LoginView.swift` or `RawkoonTabBar.swift`, run it without `--lint`, copy those files back with `rsync -a macbuild:~/build/rawkoon-hig/apps/ios/Rawkoon/ apps/ios/Rawkoon/`, and commit them on the task that introduced the unformatted code.

- [ ] **Step 2: Rebuild and retake the three shots**

Sync again so macbuild matches the branch, then the global build. Retake `/tmp/hig-login-medium.png`, `/tmp/hig-login-ax.png`, and `/tmp/hig-tabbar.png` with the commands in Tasks 1 and 4. Reset the simulator when done:

```bash
ssh macbuild 'export PATH=/opt/homebrew/bin:$PATH
UDID=$(xcrun simctl list devices | grep "iPhone 17 Pro" | grep Booted | head -1 | sed -E "s/.*\(([A-F0-9-]+)\).*/\1/")
xcrun simctl ui "$UDID" content_size medium
xcrun simctl ui "$UDID" increase_contrast disabled'
```

- [ ] **Step 3: Look at the three PNGs**

Medium login: side-by-side lockup, faded Sign In, 44pt fields on the Mac layout (the iPhone shot is the phone form). AX login: one-line "Rawkoon", logo above the word. Tab bar: icons unchanged from before Task 4.

---
