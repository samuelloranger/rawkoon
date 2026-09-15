import SwiftUI

struct LoginView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.horizontalSizeClass) private var hSizeClass
    @State private var email = ""
    @State private var password = ""
    @State private var revealPassword = false

    private var isRegularWidth: Bool { hSizeClass == .regular }

    var body: some View {
        NavigationStack {
            ZStack {
                background
                if isRegularWidth {
                    macLayout(model)
                } else {
                    phoneForm(model)
                }
            }
            .task { await model.loadSsoProviders() }
            .onChange(of: model.serverURL) { _, _ in
                Task { await model.loadSsoProviders() }
            }
        }
    }

    private var background: some View {
        ZStack {
            LinearGradient(
                colors: [Color(hex: 0x2A201B), Theme.base],
                startPoint: .top, endPoint: .bottom
            )
            Theme.duskGlow
        }
        .ignoresSafeArea()
    }

    // MARK: - Mac / regular width: a centered sign-in card

    private func macLayout(_ model: AppModel) -> some View {
        @Bindable var model = model
        return ScrollView {
            VStack(spacing: 26) {
                VStack(spacing: 14) {
                    Image("AppLogo")
                        .resizable()
                        .frame(width: 64, height: 64)
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                    Text("Rawkoon")
                        .font(.display(34, weight: .semibold))
                        .foregroundStyle(Theme.textStrong)
                    Text("Sign in to your library")
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                }

                VStack(spacing: 16) {
                    fieldRow("Server") {
                        TextField("", text: $model.serverURL, prompt: prompt(verbatim: "https://your-rawkoon-server"))
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }
                    fieldRow("Email") {
                        TextField("", text: $email, prompt: prompt("Email"))
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }
                    fieldRow("Password") {
                        HStack(spacing: 8) {
                            Group {
                                if revealPassword {
                                    TextField("", text: $password, prompt: prompt("Password"))
                                } else {
                                    SecureField("", text: $password, prompt: prompt("Password"))
                                }
                            }
                            .textContentType(.password)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            Button {
                                revealPassword.toggle()
                            } label: {
                                Image(systemName: revealPassword ? "eye.slash" : "eye")
                                    .foregroundStyle(Theme.muted)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(Text(LocalizedStringKey(revealPassword ? "Hide password" : "Show password")))
                        }
                    }
                }

                signInButton(model)

                if !model.ssoProviders.isEmpty {
                    ssoBlock(model)
                }

                if let errorMessage = model.errorMessage {
                    Text(errorMessage)
                        .foregroundStyle(Theme.terracotta)
                        .font(.footnote)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .frame(width: 380)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 48)
        }
        .tint(Theme.apricot)
    }

    private func fieldRow(_ label: LocalizedStringKey, @ViewBuilder _ field: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.caption)
                .foregroundStyle(Theme.muted)
            field()
                .textFieldStyle(.plain)
                .foregroundStyle(Theme.text)
                .padding(.horizontal, 12)
                .frame(height: 42)
                .background(Theme.well, in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.border, lineWidth: 1))
        }
    }

    private func signInButton(_ model: AppModel) -> some View {
        Button {
            Task {
                await model.login(server: model.serverURL, email: email, password: password)
            }
        } label: {
            Group {
                if model.loading {
                    ProgressView().tint(Theme.onAccent)
                } else {
                    Text("Sign In").fontWeight(.semibold)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 46)
            .foregroundStyle(Theme.onAccent)
            .background(Theme.apricot, in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .disabled(model.loading || email.isEmpty || password.isEmpty || model.serverURL.isEmpty)
        .opacity(email.isEmpty || password.isEmpty || model.serverURL.isEmpty ? 0.6 : 1)
    }

    private func ssoBlock(_ model: AppModel) -> some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                Rectangle().fill(Theme.border).frame(height: 1)
                Text("Or").font(.caption).foregroundStyle(Theme.muted)
                Rectangle().fill(Theme.border).frame(height: 1)
            }
            ForEach(model.ssoProviders) { provider in
                Button {
                    Task { await model.signInWithProvider(provider.slug) }
                } label: {
                    HStack(spacing: 10) {
                        if model.loading {
                            ProgressView().tint(Theme.muted).frame(width: 20, height: 20)
                        } else {
                            AsyncImage(url: providerIconURL(provider)) { image in
                                image.resizable().scaledToFit()
                            } placeholder: {
                                Image(systemName: "person.badge.key.fill").foregroundStyle(Theme.muted)
                            }
                            .frame(width: 20, height: 20)
                        }
                        Text("Sign in with \(provider.name)").fontWeight(.medium)
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
        }
    }

    // MARK: - Phone (compact): the original form, unchanged

    private func phoneForm(_ model: AppModel) -> some View {
        @Bindable var model = model
        return Form {
            Section {
                HStack(spacing: 14) {
                    Image("AppLogo")
                        .resizable()
                        .frame(width: 52, height: 52)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    Text("Rawkoon")
                        .font(.display(40, weight: .semibold))
                        .foregroundStyle(Theme.textStrong)
                }
                .padding(.vertical, 10)
                .listRowBackground(Color.clear)
            }

            Section("Server") {
                TextField("", text: $model.serverURL, prompt: prompt(verbatim: "https://your-rawkoon-server"))
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .foregroundStyle(Theme.text)
            }
            .listRowBackground(Theme.raised)

            Section("Credentials") {
                TextField("", text: $email, prompt: prompt("Email"))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.emailAddress)
                    .foregroundStyle(Theme.text)
                HStack {
                    Group {
                        if revealPassword {
                            TextField("", text: $password, prompt: prompt("Password"))
                        } else {
                            SecureField("", text: $password, prompt: prompt("Password"))
                        }
                    }
                    .textContentType(.password)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .foregroundStyle(Theme.text)

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
            .listRowBackground(Theme.raised)

            Section {
                Button {
                    Task {
                        await model.login(server: model.serverURL, email: email, password: password)
                    }
                } label: {
                    Group {
                        if model.loading {
                            ProgressView().tint(Theme.onAccent)
                        } else {
                            Text("Sign In").fontWeight(.semibold)
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
                .disabled(model.loading || email.isEmpty || password.isEmpty || model.serverURL.isEmpty)
                .listRowBackground(Theme.apricot)
                .foregroundStyle(Theme.onAccent)
            }

            if !model.ssoProviders.isEmpty {
                Section {
                    ForEach(model.ssoProviders) { provider in
                        Button {
                            Task { await model.signInWithProvider(provider.slug) }
                        } label: {
                            HStack(spacing: 10) {
                                if model.loading {
                                    ProgressView().tint(Theme.muted)
                                        .frame(width: 20, height: 20)
                                } else {
                                    AsyncImage(url: providerIconURL(provider)) { image in
                                        image.resizable().scaledToFit()
                                    } placeholder: {
                                        Image(systemName: "person.badge.key.fill")
                                            .foregroundStyle(Theme.muted)
                                    }
                                    .frame(width: 20, height: 20)
                                }
                                Text("Sign in with \(provider.name)")
                                    .fontWeight(.medium)
                                Spacer()
                            }
                            .foregroundStyle(Theme.textStrong)
                        }
                        .disabled(model.loading)
                    }
                } header: {
                    Text("Or")
                }
                .listRowBackground(Theme.raised)
            }

            if let errorMessage = model.errorMessage {
                Section {
                    Text(errorMessage)
                        .foregroundStyle(Theme.terracotta)
                        .font(.footnote)
                }
                .listRowBackground(Theme.raised)
            }
        }
        .scrollContentBackground(.hidden)
        .tint(Theme.apricot)
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

    private func prompt(_ text: LocalizedStringKey) -> Text {
        Text(text).foregroundStyle(Theme.muted)
    }

    private func prompt(verbatim text: String) -> Text {
        Text(verbatim: text).foregroundStyle(Theme.muted)
    }
}
