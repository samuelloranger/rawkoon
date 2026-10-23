import SwiftUI

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
                .padding(.horizontal, 12)
                .frame(height: 44)
                .background(Theme.well, in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.border, lineWidth: 1))
        }
    }
}

/// "Sign in with Jellyfin": a button that opens a username and password form in place.
struct LoginJellyfinBlock: View {
    let model: AppModel
    /// Called on a user's sign-in tap, so Login can tell a fresh sign-in from a restored session.
    let onAttempt: () -> Void

    @State private var showForm = false
    @State private var username = ""
    @State private var password = ""
    @FocusState private var focus: Field?

    private enum Field: Hashable {
        case username, password
    }

    private var fieldsReady: Bool {
        !username.isEmpty && !password.isEmpty && !model.serverURL.isEmpty
    }

    private func submit() {
        guard fieldsReady, !model.loading, !model.isLoggedIn else { return }
        onAttempt()
        Task {
            await model.loginWithJellyfin(server: model.serverURL, username: username, password: password)
        }
    }

    var body: some View {
        VStack(spacing: 10) {
            if showForm {
                form
            } else {
                openButton
            }
        }
    }

    @ViewBuilder private var form: some View {
        LoginFieldRow("Jellyfin username") {
            TextField("", text: $username, prompt: prompt("Jellyfin username"))
                .textContentType(.username)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused($focus, equals: .username)
                .submitLabel(.next)
                .onSubmit { focus = .password }
        }
        LoginFieldRow("Jellyfin password") {
            SecureField("", text: $password, prompt: prompt("Jellyfin password"))
                .textContentType(.password)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused($focus, equals: .password)
                .submitLabel(.go)
                .onSubmit { submit() }
        }
        Text("Your password is checked by the Jellyfin server and not stored.")
            .font(.caption)
            .foregroundStyle(Theme.muted)
            .frame(maxWidth: .infinity, alignment: .leading)
        HStack(spacing: 10) {
            Button("Back") {
                showForm = false
                password = ""
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.muted)
            .frame(minHeight: 44)
            Button {
                submit()
            } label: {
                Group {
                    if model.loading {
                        ProgressView().tint(Theme.onAccent)
                    } else {
                        Text("Continue").fontWeight(.semibold)
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(height: 44)
                .foregroundStyle(Theme.onAccent)
                .background(Theme.apricot, in: RoundedRectangle(cornerRadius: 12))
            }
            .buttonStyle(.plain)
            .disabled(model.loading || !fieldsReady)
            .opacity(fieldsReady ? 1 : 0.6)
        }
    }

    private var openButton: some View {
        Button {
            showForm = true
            focus = .username
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "play.tv.fill").foregroundStyle(Theme.muted)
                    .frame(width: 20, height: 20)
                Text("Sign in with Jellyfin").fontWeight(.medium)
                Spacer()
            }
            .foregroundStyle(Theme.textStrong)
            .padding(.horizontal, 12)
            .frame(height: 44)
            .background(Theme.raised, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(model.loading)
    }

    private func prompt(_ text: LocalizedStringKey) -> Text {
        Text(text).foregroundStyle(Theme.muted)
    }
}
