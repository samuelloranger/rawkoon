import RawkoonKit
import SwiftUI

/// Login step three, reached from the Jellyfin row: the Jellyfin username and password.
struct LoginJellyfinStep: View {
    @Environment(AppModel.self) private var model
    @Binding var signInAttempted: Bool

    @State private var username = ""
    @State private var password = ""
    @FocusState private var focus: Field?

    private enum Field: Hashable {
        case username, password
    }

    private var fieldsReady: Bool {
        !username.isEmpty && !password.isEmpty
    }

    var body: some View {
        LoginScreen {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 12) {
                    Image("JellyfinLogo")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 30, height: 30)
                        .accessibilityHidden(true)
                    Text(verbatim: "Jellyfin")
                        .font(.display(30, weight: .semibold))
                        .foregroundStyle(Theme.textStrong)
                }
                Text("Sign in to \(ServerAddress.displayName(model.serverURL)) with the username and password you use in Jellyfin.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .rawkoonEntrance(id: "title")

            VStack(spacing: 14) {
                LoginFieldRow("Jellyfin username") {
                    TextField("", text: $username, prompt: loginPrompt("Username"))
                        .textContentType(.username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focus, equals: .username)
                        .submitLabel(.next)
                        .onSubmit { focus = .password }
                }
                LoginFieldRow("Jellyfin password") {
                    SecureField("", text: $password, prompt: loginPrompt("Password"))
                        .textContentType(.password)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focus, equals: .password)
                        .submitLabel(.go)
                        .onSubmit(submit)
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

            Text("Your Jellyfin server checks the password. Rawkoon doesn't store it.")
                .font(.footnote)
                .foregroundStyle(Theme.faint)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 20)
                .rawkoonEntrance(id: "note")
        }
        .navigationBarBackButtonHidden(model.loading)
        .onAppear { focus = .username }
        .onChange(of: model.isLoggedIn) { _, signedIn in
            if signedIn {
                focus = nil
            }
        }
    }

    private func submit() {
        guard fieldsReady, !model.loading, !model.isLoggedIn else { return }
        signInAttempted = true
        let attemptedPassword = password
        Task {
            await model.loginWithJellyfin(server: model.serverURL, username: username, password: attemptedPassword)
            // The password never outlives the attempt, whatever its outcome.
            password = ""
        }
    }
}
