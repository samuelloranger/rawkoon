import SwiftUI

/// The steps after the server one; the server step is the stack's root.
enum LoginStep: Hashable {
    case signIn, jellyfin
}

/// Shared frame for every login step: dusk background, one readable column, shake on a failed attempt.
struct LoginScreen<Content: View>: View {
    @Environment(AppModel.self) private var model
    @ViewBuilder let content: Content

    var body: some View {
        // Read here so the shake's predicate sees the session state of the render that changed the error.
        let signedIn = model.isLoggedIn
        return ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                content
            }
            .frame(maxWidth: 400, alignment: .leading)
            .padding(.horizontal, 24)
            .padding(.top, 28)
            .padding(.bottom, 40)
            .frame(maxWidth: .infinity)
            .rawkoonEntranceScope()
            // A failed sign-in shakes the form; an error after the session opened is the library load's.
            .rawkoonShake(trigger: model.errorMessage, when: { _, new in new != nil && !signedIn })
            .rawkoonMotion(RawkoonMotion.spring, value: model.errorMessage)
        }
        .scrollDismissesKeyboard(.interactively)
        .background { LoginBackground() }
        .toolbarBackground(.hidden, for: .navigationBar)
        .tint(Theme.apricot)
    }
}

struct LoginBackground: View {
    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(hex: 0x2A201B), Theme.base], startPoint: .top, endPoint: .bottom)
            Theme.duskGlow
        }
        .ignoresSafeArea()
    }
}

/// Logo and wordmark, side by side until "Rawkoon" no longer fits on one line.
struct LoginLockup: View {
    let titleSize: CGFloat
    let logoSide: CGFloat

    var body: some View {
        ViewThatFits(in: .horizontal) {
            lockup(stacked: false)
            lockup(stacked: true)
        }
        // A logo, not body copy. Accessibility sizes enlarge the fields, not this.
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
    }

    @ViewBuilder
    private func lockup(stacked: Bool) -> some View {
        let logo = Image("AppLogo")
            .resizable()
            .frame(width: logoSide, height: logoSide)
            .clipShape(RoundedRectangle(cornerRadius: logoSide * 0.25, style: .continuous))
        let title = Text("Rawkoon")
            .font(.display(titleSize, weight: .semibold))
            .foregroundStyle(Theme.textStrong)
            .lineLimit(1)
        if stacked {
            VStack(alignment: .leading, spacing: 8) {
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
}

/// The login form's labelled field: caption above a well-backed input.
struct LoginFieldRow<Field: View>: View {
    let label: LocalizedStringKey
    let field: Field

    init(_ label: LocalizedStringKey, @ViewBuilder field: () -> Field) {
        self.label = label
        self.field = field()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.caption)
                .foregroundStyle(Theme.muted)
            field
                .textFieldStyle(.plain)
                .foregroundStyle(Theme.text)
                .padding(.horizontal, 14)
                .frame(minHeight: 48)
                .background(Theme.well, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.border, lineWidth: 1))
        }
    }
}

/// The one apricot action on a step: a title, then a spinner, then a check once the session opens.
struct LoginPrimaryButton: View {
    let title: LocalizedStringKey
    let face: SignInFace
    let enabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                switch face {
                case .signedIn:
                    Image(systemName: "checkmark")
                        .fontWeight(.bold)
                        .transition(.rawkoonPop)
                case .loading:
                    ProgressView().tint(Theme.onAccent)
                        .transition(.rawkoonSwap)
                case .idle:
                    Text(title).fontWeight(.semibold)
                        .transition(.rawkoonSwap)
                }
            }
            .rawkoonMotion(RawkoonMotion.snappy, value: face)
            .frame(maxWidth: .infinity)
            .frame(minHeight: 48)
            .foregroundStyle(Theme.onAccent)
            .background(Theme.apricot, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(!enabled || face != .idle)
        .opacity(enabled || face != .idle ? 1 : 0.55)
    }
}

/// Another way to sign in: SSO providers and Jellyfin share this row, so they read as one list.
struct LoginMethodRow<Icon: View>: View {
    let title: Text
    let busy: Bool
    let action: () -> Void
    let icon: Icon

    init(_ title: Text, busy: Bool, action: @escaping () -> Void, @ViewBuilder icon: () -> Icon) {
        self.title = title
        self.busy = busy
        self.action = action
        self.icon = icon()
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Group {
                    if busy {
                        ProgressView().tint(Theme.muted)
                    } else {
                        icon
                    }
                }
                .frame(width: 22, height: 22)
                title
                    .fontWeight(.medium)
                    .foregroundStyle(Theme.textStrong)
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Theme.faint)
            }
            .padding(.horizontal, 14)
            .frame(minHeight: 50)
            .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.border, lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(busy)
    }
}

/// The current step's error, placed right under its action so it is on screen when it appears.
struct LoginErrorText: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if let errorMessage = model.errorMessage {
            Text(errorMessage)
                .font(.footnote)
                .foregroundStyle(Theme.terracotta)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 12)
                .transition(.rawkoonReveal)
        }
    }
}

func loginPrompt(_ text: LocalizedStringKey) -> Text {
    Text(text).foregroundStyle(Theme.muted)
}

func loginPrompt(verbatim text: String) -> Text {
    Text(verbatim: text).foregroundStyle(Theme.muted)
}
