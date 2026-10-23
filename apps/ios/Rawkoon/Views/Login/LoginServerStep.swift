import SwiftUI

/// Login step one: which Rawkoon server to sign in to.
struct LoginServerStep: View {
    @Environment(AppModel.self) private var model
    let onConnected: () -> Void

    @State private var address = ""
    @State private var connecting = false
    @FocusState private var fieldFocused: Bool

    private var ready: Bool {
        !address.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        LoginScreen {
            LoginLockup(titleSize: 40, logoSide: 56)
                .padding(.top, 24)
                .rawkoonEntrance(id: "lockup")

            Text("Connect to your Rawkoon server to sign in.")
                .font(.body)
                .foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 14)
                .rawkoonEntrance(id: "intro")

            LoginFieldRow("Server address") {
                TextField("", text: $address, prompt: loginPrompt(verbatim: "rawkoon.example.com"))
                    .textContentType(.URL)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($fieldFocused)
                    .submitLabel(.continue)
                    .onSubmit(connect)
            }
            .padding(.top, 36)
            .rawkoonEntrance(id: "server")

            LoginPrimaryButton(title: "Connect", face: connecting ? .loading : .idle, enabled: ready, action: connect)
                .padding(.top, 16)
                .rawkoonEntrance(id: "connect")

            LoginErrorText()
        }
        .toolbar(.hidden, for: .navigationBar)
        .onAppear {
            if address.isEmpty {
                address = model.serverURL
            }
        }
    }

    private func connect() {
        guard ready, !connecting else { return }
        connecting = true
        fieldFocused = false
        Task {
            let connected = await model.connect(to: address)
            connecting = false
            if connected {
                onConnected()
            }
        }
    }
}
