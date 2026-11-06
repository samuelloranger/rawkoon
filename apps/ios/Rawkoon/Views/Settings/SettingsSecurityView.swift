import SwiftUI

/// Security (all users): change the password, subscribe to the library calendar, and a pointer to passkeys.
struct SettingsSecurityView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL

    @State private var currentPassword = ""
    @State private var newPassword = ""
    @State private var confirmPassword = ""
    @State private var changingPassword = false
    @State private var passwordError: String?
    @State private var passwordDone = false

    @State private var openingCalendar = false
    @State private var calendarError: String?

    private var passwordValid: Bool {
        newPassword.count >= 8 && newPassword == confirmPassword && !currentPassword.isEmpty
    }

    var body: some View {
        Form {
            Section {
                SecretFieldRow(title: "Current password", input: $currentPassword)
                SecretFieldRow(title: "New password (min 8)", input: $newPassword)
                SecretFieldRow(title: "Confirm new password", input: $confirmPassword)
                Button("Change password") { Task { await changePassword() } }
                    .disabled(!passwordValid || changingPassword)
                    .requiresConnection(model.isOffline)
                    .listRowBackground(Theme.raised)
                if passwordDone {
                    Text("Password updated.").foregroundStyle(Theme.apricot).listRowBackground(Theme.raised)
                }
                if let passwordError {
                    Text(passwordError).foregroundStyle(Theme.danger).listRowBackground(Theme.raised)
                }
            } header: { Text("Password") }

            Section {
                Button("Add to Calendar") { Task { await subscribeToCalendar() } }
                    .disabled(openingCalendar)
                    .requiresConnection(model.isOffline)
                    .listRowBackground(Theme.raised)
                if let calendarError {
                    Text(calendarError).foregroundStyle(Theme.danger).listRowBackground(Theme.raised)
                }
            } header: {
                Text("Calendar")
            } footer: {
                Text("Subscribe to your library's release dates in the Calendar app.")
            }

            Section {
                Text("Add or remove passkeys from the web app.")
                    .font(.footnote).foregroundStyle(Theme.muted).listRowBackground(Theme.raised)
            } header: { Text("Passkeys") }
        }
        .scrollContentBackground(.hidden)
        .readableWidth()
        .background(Theme.base)
        .tint(Theme.apricot)
        .navigationTitle("Security")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func subscribeToCalendar() async {
        guard let client = model.api() else { return }
        openingCalendar = true; calendarError = nil
        do {
            let subscription = try await client.calendarSubscription()
            if let url = URL(string: subscription.webcalUrl) {
                openURL(url)
            } else {
                calendarError = String(localized: "Couldn't open the calendar link.")
            }
        } catch {
            calendarError = String(localized: "Couldn't open the calendar link.")
        }
        openingCalendar = false
    }

    private func changePassword() async {
        guard let client = model.api() else { return }
        changingPassword = true; passwordError = nil; passwordDone = false
        do {
            try await client.changePassword(
                ChangePasswordBody(currentPassword: currentPassword, newPassword: newPassword)
            )
            passwordDone = true
            currentPassword = ""; newPassword = ""; confirmPassword = ""
        } catch let error as APIError {
            if case .http(400) = error {
                passwordError = String(localized: "Current password is incorrect.")
            } else {
                passwordError = String(localized: "Couldn't change password.")
            }
        } catch {
            passwordError = String(localized: "Couldn't change password.")
        }
        changingPassword = false
    }
}
