import SwiftUI

/// Account profile (all users): edit name, change password. Email is read-only.
/// Avatar upload and passkey registration are deferred to the web app.
struct ProfileView: View {
    @Environment(AppModel.self) private var model

    @State private var loading = true
    @State private var loadError: String?

    @State private var email = ""
    @State private var firstName = ""
    @State private var lastName = ""
    @State private var loadedFirst = ""
    @State private var loadedLast = ""
    @State private var savingName = false
    @State private var nameError: String?

    @State private var currentPassword = ""
    @State private var newPassword = ""
    @State private var confirmPassword = ""
    @State private var changingPassword = false
    @State private var passwordError: String?
    @State private var passwordDone = false

    private var nameDirty: Bool {
        firstName != loadedFirst || lastName != loadedLast
    }

    private var passwordValid: Bool {
        newPassword.count >= 8 && newPassword == confirmPassword && !currentPassword.isEmpty
    }

    var body: some View {
        Form {
            SettingsStateView(isLoading: loading, error: loadError, retry: { Task { await load() } }) {
                Section {
                    LabeledContent("Email") { Text(email).foregroundStyle(Theme.muted).textSelection(.enabled) }
                        .listRowBackground(Theme.raised)
                    LabeledTextFieldRow(title: "First name", text: $firstName, autocaps: true)
                    LabeledTextFieldRow(title: "Last name", text: $lastName, autocaps: true)
                    Button("Save name") { Task { await saveName() } }
                        .disabled(!nameDirty || savingName)
                        .listRowBackground(Theme.raised)
                    if let nameError {
                        Text(nameError).foregroundStyle(Theme.terracotta).listRowBackground(Theme.raised)
                    }
                } header: { Text("Profile") }

                Section {
                    SecretFieldRow(title: "Current password", input: $currentPassword)
                    SecretFieldRow(title: "New password (min 8)", input: $newPassword)
                    SecretFieldRow(title: "Confirm new password", input: $confirmPassword)
                    Button("Change password") { Task { await changePassword() } }
                        .disabled(!passwordValid || changingPassword)
                        .listRowBackground(Theme.raised)
                    if passwordDone {
                        Text("Password updated.").foregroundStyle(Theme.apricot).listRowBackground(Theme.raised)
                    }
                    if let passwordError {
                        Text(passwordError).foregroundStyle(Theme.terracotta).listRowBackground(Theme.raised)
                    }
                } header: { Text("Password") }

                Section {
                    Text("Add or remove passkeys from the web app.")
                        .font(.footnote).foregroundStyle(Theme.muted).listRowBackground(Theme.raised)
                } header: { Text("Passkeys") }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.base)
        .tint(Theme.apricot)
        .navigationTitle("Profile")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { Task { await load() } }
    }

    private func load() async {
        guard let client = model.api() else { loading = false; return }
        loading = true; loadError = nil
        do {
            let user = try await client.currentUser().user
            email = user?.email ?? ""
            firstName = user?.firstName ?? ""
            lastName = user?.lastName ?? ""
            loadedFirst = firstName
            loadedLast = lastName
        } catch {
            loadError = settingsErrorMessage(error, admin: false)
        }
        loading = false
    }

    private func saveName() async {
        guard let client = model.api() else { return }
        savingName = true; nameError = nil
        do {
            try await client.updateProfile(UpdateProfileBody(firstName: firstName, lastName: lastName))
            loadedFirst = firstName
            loadedLast = lastName
        } catch {
            nameError = "Couldn't save your name."
        }
        savingName = false
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
                passwordError = "Current password is incorrect."
            } else {
                passwordError = "Couldn't change password."
            }
        } catch {
            passwordError = "Couldn't change password."
        }
        changingPassword = false
    }
}
