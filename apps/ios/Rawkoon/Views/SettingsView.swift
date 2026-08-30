import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var model: AppModel
    @AppStorage("download_over") private var downloadOver = "any"

    var body: some View {
        Form {
            Section("Server") {
                TextField("Server URL", text: $model.serverURL)
                    .disabled(true)
                    .textSelection(.enabled)
            }

            Section("Downloads") {
                Picker("Download over", selection: $downloadOver) {
                    Text("Any").tag("any")
                    Text("Wi-Fi").tag("wifi")
                }
                .pickerStyle(.segmented)

                Button("Delete Downloads", role: .destructive) {
                    model.deleteDownloads()
                }
            }

            Section {
                Button("Log Out", role: .destructive) {
                    model.logout()
                }
            }
        }
        .navigationTitle("Settings")
    }
}
