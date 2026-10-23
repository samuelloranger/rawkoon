import RawkoonKit
import SwiftUI

/// Login step two: every way the chosen server lets you sign in.
struct LoginSignInStep: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Binding var signInAttempted: Bool
    let onJellyfin: () -> Void

    @State private var email = ""
    @State private var password = ""
    @State private var revealPassword = false
    @FocusState private var focus: Field?

    private enum Field: Hashable {
        case email, password
    }

    private var fieldsReady: Bool {
        !email.isEmpty && !password.isEmpty
    }

    private var hasOtherMethods: Bool {
        !model.ssoProviders.isEmpty || model.jellyfinSignInEnabled
    }

    var body: some View {
        LoginScreen {
            VStack(alignment: .leading, spacing: 4) {
                Text("Sign in to")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
                // The server you are joining is the title: it is the one thing this screen is about.
                Text(verbatim: ServerAddress.displayName(model.serverURL))
                    .font(.display(30, weight: .semibold))
                    .foregroundStyle(Theme.textStrong)
                    .lineLimit(2)
                    .minimumScaleFactor(0.6)
            }
            .rawkoonEntrance(id: "server")

            VStack(spacing: 14) {
                LoginFieldRow("Email") {
                    TextField("", text: $email, prompt: loginPrompt("Email"))
                        .textContentType(.username)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focus, equals: .email)
                        .submitLabel(.next)
                        .onSubmit { focus = .password }
                }
                LoginFieldRow("Password") {
                    HStack(spacing: 8) {
                        Group {
                            if revealPassword {
                                TextField("", text: $password, prompt: loginPrompt("Password"))
                            } else {
                                SecureField("", text: $password, prompt: loginPrompt("Password"))
                            }
                        }
                        .textContentType(.password)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focus, equals: .password)
                        .submitLabel(.go)
                        .onSubmit(submit)
                        Button {
                            revealPassword.toggle()
                        } label: {
                            Image(systemName: revealPassword ? "eye.slash" : "eye")
                                .foregroundStyle(Theme.muted)
                                .frame(width: 44, height: 44)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text(LocalizedStringKey(revealPassword ? "Hide password" : "Show password")))
                    }
                }
            }
            .padding(.top, 32)
            .rawkoonEntrance(id: "fields")

            LoginPrimaryButton(
                title: "Sign In",
                face: SignInFace.face(loading: model.loading, signedIn: model.isLoggedIn),
                enabled: fieldsReady,
                action: submit
            )
            .rawkoonCelebrate(
                trigger: model.isLoggedIn, ring: .roundedRect(cornerRadius: 12), tint: Theme.seed,
                when: { old, new in !old && new && signInAttempted }
            )
            .padding(.top, 20)
            .rawkoonEntrance(id: "signIn")

            LoginErrorText()

            if hasOtherMethods {
                methods
                    .padding(.top, 28)
                    .rawkoonEntrance(id: "methods")
            }
        }
        .navigationBarBackButtonHidden()
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    dismiss()
                } label: {
                    Label("Change server", systemImage: "chevron.left")
                        .labelStyle(.titleAndIcon)
                        .font(.subheadline.weight(.medium))
                }
                .disabled(model.loading)
            }
        }
        .task { await model.loadSsoProviders() }
        .onChange(of: model.isLoggedIn) { _, signedIn in
            if signedIn {
                focus = nil
            }
        }
    }

    private var methods: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Or sign in with")
                .font(.footnote)
                .foregroundStyle(Theme.muted)
            ForEach(model.ssoProviders) { provider in
                LoginMethodRow(Text(verbatim: provider.name), busy: model.loading) {
                    signIn(with: provider)
                } icon: {
                    AsyncImage(url: providerIconURL(provider)) { image in
                        image.resizable().scaledToFit()
                    } placeholder: {
                        Image(systemName: "person.badge.key.fill").foregroundStyle(Theme.muted)
                    }
                }
            }
            if model.jellyfinSignInEnabled {
                LoginMethodRow(Text(verbatim: "Jellyfin"), busy: false, action: onJellyfin) {
                    Image("JellyfinLogo").resizable().scaledToFit()
                }
                .disabled(model.loading)
            }
        }
    }

    private func submit() {
        // A lingering Login after the session opened must not start a second sign-in.
        guard fieldsReady, !model.loading, !model.isLoggedIn else { return }
        signInAttempted = true
        Task { await model.login(server: model.serverURL, email: email, password: password) }
    }

    private func signIn(with provider: SsoProvider) {
        guard !model.isLoggedIn else { return }
        signInAttempted = true
        Task { await model.signInWithProvider(provider.slug) }
    }

    /// The provider's configured icon, or the same slug-based dashboard-icons CDN
    /// fallback the web login uses (`oidcProviderIconUrl`) — the server returns a
    /// null `icon_url` for built-in providers like Google.
    private func providerIconURL(_ provider: SsoProvider) -> URL? {
        if let icon = provider.iconUrl, let url = model.absoluteURL(icon) {
            return url
        }
        return URL(string: "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/\(provider.slug).png")
    }
}
