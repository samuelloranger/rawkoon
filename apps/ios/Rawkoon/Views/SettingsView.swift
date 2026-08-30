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
                    .foregroundStyle(Theme.muted)
            }
            .listRowBackground(Theme.raised)

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
            .listRowBackground(Theme.raised)

            Section {
                Button("Log Out", role: .destructive) {
                    model.logout()
                }
            }
            .listRowBackground(Theme.raised)
        }
        .scrollContentBackground(.hidden)
        .background(Theme.base)
        .tint(Theme.apricot)
        .navigationTitle("Settings")
    }
}
