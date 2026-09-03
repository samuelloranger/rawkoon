import SwiftUI

struct LoginView: View {
    @Environment(AppModel.self) private var model
    @State private var email = ""
    @State private var password = ""
    @State private var revealPassword = false

    var body: some View {
        @Bindable var model = model
        return NavigationStack {
            ZStack {
                LinearGradient(
                    colors: [Color(hex: 0x2A201B), Theme.base],
                    startPoint: .top, endPoint: .bottom
                )
                .ignoresSafeArea()
                Theme.duskGlow.ignoresSafeArea()

                Form {
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
                        TextField("", text: $model.serverURL, prompt: prompt("https://your-rawkoon-server"))
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
                            .accessibilityLabel(revealPassword ? "Hide password" : "Show password")
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
                                            AsyncImage(url: URL(string: provider.iconUrl ?? "")) { image in
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
                .task { await model.loadSsoProviders() }
                .onChange(of: model.serverURL) { _, _ in
                    Task { await model.loadSsoProviders() }
                }
            }
        }
    }

    private func prompt(_ text: String) -> Text {
        Text(text).foregroundStyle(Theme.muted)
    }
}
