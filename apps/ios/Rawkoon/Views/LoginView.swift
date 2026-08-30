import SwiftUI

struct LoginView: View {
    @EnvironmentObject private var model: AppModel
    @State private var email = ""
    @State private var password = ""

    var body: some View {
        NavigationStack {
            ZStack {
                LinearGradient(
                    colors: [Color(hex: 0x2A201B), Theme.base],
                    startPoint: .top, endPoint: .bottom
                )
                .ignoresSafeArea()
                Theme.duskGlow.ignoresSafeArea()

                Form {
                    Section {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Rawkoon")
                                .font(.display(40, weight: .semibold))
                                .foregroundStyle(Theme.textStrong)
                            Text("Your library, lit at dusk.")
                                .font(.subheadline)
                                .foregroundStyle(Theme.muted)
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
                        SecureField("", text: $password, prompt: prompt("Password"))
                            .foregroundStyle(Theme.text)
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
        }
    }

    private func prompt(_ text: String) -> Text {
        Text(text).foregroundStyle(Theme.muted)
    }
}
