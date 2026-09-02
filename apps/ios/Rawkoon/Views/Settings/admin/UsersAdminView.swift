import SwiftUI

/// Users admin (admin): list with role toggle, password reset, delete; plus a
/// provisioning sheet (add user / generate invite) and an invitations screen.
struct UsersAdminView: View {
    @Environment(AppModel.self) private var model

    @State private var users: [AdminUser] = []
    @State private var loading = true
    @State private var loadError: String?
    @State private var actionError: String?

    @State private var showProvision = false
    @State private var resetUser: AdminUser?
    @State private var newPassword = ""

    var body: some View {
        Group {
            if !model.isAdmin {
                ContentUnavailableView("Admin only", systemImage: "lock")
            } else {
                list
            }
        }
        .navigationTitle("Users")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var list: some View {
        Form {
            Section {
                NavigationLink { InvitationsView() } label: {
                    Label("Invitations", systemImage: "envelope")
                }
                .listRowBackground(Theme.raised)
            }
            SettingsStateView(isLoading: loading, error: loadError, retry: { Task { await load() } }) {
                ForEach(users) { user in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(displayName(user)).foregroundStyle(Theme.text)
                        Text(user.email + (user.isAdmin ? " \u{2022} admin" : ""))
                            .font(.footnote).foregroundStyle(Theme.muted)
                    }
                    .listRowBackground(Theme.raised)
                    .swipeActions {
                        Button("Delete", role: .destructive) { Task { await delete(user) } }
                        Button(user.isAdmin ? "Make user" : "Make admin") {
                            Task { await toggleRole(user) }
                        }.tint(Theme.apricot)
                        Button("Reset") { resetUser = user; newPassword = "" }.tint(Theme.terracotta)
                    }
                }
                if let actionError {
                    Text(actionError).foregroundStyle(Theme.terracotta).listRowBackground(Theme.raised)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.base)
        .tint(Theme.apricot)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showProvision = true } label: { Image(systemName: "person.badge.plus") }
            }
        }
        .sheet(isPresented: $showProvision) {
            NavigationStack { ProvisioningSheet(onDone: { Task { await load() } }) }
        }
        .alert("Reset password", isPresented: Binding(get: { resetUser != nil }, set: { if !$0 { resetUser = nil } })) {
            SecureField("New password (min 8)", text: $newPassword)
            Button("Reset") { Task { await resetPassword() } }
            Button("Cancel", role: .cancel) { resetUser = nil }
        } message: {
            Text("Sets a new password and signs the user out everywhere.")
        }
        .onAppear { Task { await load() } }
    }

    private func displayName(_ user: AdminUser) -> String {
        let name = [user.firstName, user.lastName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
        return name.isEmpty ? user.email : name
    }

    private func load() async {
        guard let client = model.api() else { loading = false; return }
        loading = true; loadError = nil
        do { users = try await client.adminUsers().users }
        catch { loadError = settingsErrorMessage(error) }
        loading = false
    }

    private func toggleRole(_ user: AdminUser) async {
        guard let client = model.api() else { return }
        actionError = nil
        do { try await client.setUserRole(id: user.id, isAdmin: !user.isAdmin); await load() }
        catch { actionError = settingsErrorMessage(error) }
    }

    private func delete(_ user: AdminUser) async {
        guard let client = model.api() else { return }
        actionError = nil
        do { try await client.deleteUser(id: user.id); await load() }
        catch { actionError = "Couldn't delete \(user.email)." }
    }

    private func resetPassword() async {
        guard let client = model.api(), let user = resetUser, newPassword.count >= 8 else {
            actionError = "Password must be at least 8 characters."
            return
        }
        resetUser = nil
        actionError = nil
        do { try await client.resetUserPassword(id: user.id, newPassword: newPassword) }
        catch { actionError = "Couldn't reset password." }
    }
}

private struct ProvisioningSheet: View {
    let onDone: () -> Void

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var mode = "invite"
    @State private var email = ""
    @State private var firstName = ""
    @State private var lastName = ""
    @State private var password = ""
    @State private var locale = "en"
    @State private var makeAdmin = false
    @State private var inviteLink: String?
    @State private var working = false
    @State private var error: String?

    private static let modeOptions: [(value: String, label: String)] = [
        ("invite", "Invite"), ("direct", "Add user"),
    ]
    private static let localeOptions: [(value: String, label: String)] = [
        ("en", "English"), ("fr", "French"),
    ]

    var body: some View {
        Form {
            Section { SegmentedRow(title: "Method", selection: $mode, options: Self.modeOptions) }
            Section {
                LabeledTextFieldRow(title: "Email", text: $email, keyboard: .emailAddress)
                if mode == "direct" {
                    LabeledTextFieldRow(title: "First name", text: $firstName, autocaps: true)
                    LabeledTextFieldRow(title: "Last name", text: $lastName, autocaps: true)
                    SecretFieldRow(title: "Password (min 8)", input: $password)
                }
                PickerRow(title: "Locale", selection: $locale, options: Self.localeOptions)
                Toggle("Admin", isOn: $makeAdmin).tint(Theme.apricot).listRowBackground(Theme.raised)
            }
            if let inviteLink {
                Section {
                    Text(inviteLink).font(.footnote.monospaced()).textSelection(.enabled)
                        .foregroundStyle(Theme.text).listRowBackground(Theme.raised)
                } header: {
                    Text("Invitation link (single-use, 7 days)")
                }
            }
            if let error {
                Section { Text(error).foregroundStyle(Theme.terracotta) }.listRowBackground(Theme.raised)
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.base)
        .tint(Theme.apricot)
        .navigationTitle("Add someone")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { Button("Close") { dismiss() } }
            ToolbarItem(placement: .topBarTrailing) {
                if working { ProgressView().tint(Theme.apricot) }
                else { Button("Submit") { Task { await submit() } }.disabled(email.isEmpty) }
            }
        }
    }

    private func submit() async {
        guard let client = model.api() else { return }
        working = true; error = nil
        do {
            if mode == "direct" {
                try await client.createUser(CreateUserBody(
                    email: email, password: password,
                    firstName: firstName.isEmpty ? nil : firstName,
                    lastName: lastName.isEmpty ? nil : lastName,
                    locale: locale, isAdmin: makeAdmin
                ))
                onDone()
                dismiss()
            } else {
                let response = try await client.createInvitation(
                    CreateInvitationBody(email: email, locale: locale, isAdmin: makeAdmin)
                )
                if let token = response.token {
                    inviteLink = "\(model.serverURL)/accept-invitation?token=\(token)"
                }
                onDone()
            }
        } catch {
            self.error = "Couldn't complete. Check the email and try again."
        }
        working = false
    }
}

private struct InvitationsView: View {
    @Environment(AppModel.self) private var model

    @State private var invitations: [InvitationDTO] = []
    @State private var loading = true
    @State private var loadError: String?
    @State private var actionError: String?
    @State private var link: String?

    var body: some View {
        Form {
            SettingsStateView(isLoading: loading, error: loadError, retry: { Task { await load() } }) {
                if invitations.isEmpty {
                    Text("No invitations.").foregroundStyle(Theme.muted).listRowBackground(Theme.raised)
                }
                ForEach(invitations) { invitation in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(invitation.email).foregroundStyle(Theme.text)
                        Text(invitation.status).font(.footnote).foregroundStyle(Theme.muted)
                    }
                    .listRowBackground(Theme.raised)
                    .swipeActions {
                        Button("Revoke", role: .destructive) { Task { await revoke(invitation) } }
                        Button("Resend") { Task { await resend(invitation) } }.tint(Theme.apricot)
                    }
                }
                if let link {
                    Section {
                        Text(link).font(.footnote.monospaced()).textSelection(.enabled)
                            .foregroundStyle(Theme.text).listRowBackground(Theme.raised)
                    } header: {
                        Text("New link")
                    }
                }
                if let actionError {
                    Text(actionError).foregroundStyle(Theme.terracotta).listRowBackground(Theme.raised)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.base)
        .tint(Theme.apricot)
        .navigationTitle("Invitations")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { Task { await load() } }
    }

    private func load() async {
        guard let client = model.api() else { loading = false; return }
        loading = true; loadError = nil
        do { invitations = try await client.invitations().invitations }
        catch { loadError = settingsErrorMessage(error) }
        loading = false
    }

    private func revoke(_ invitation: InvitationDTO) async {
        guard let client = model.api() else { return }
        actionError = nil
        do { try await client.revokeInvitation(id: invitation.id); await load() }
        catch { actionError = "Couldn't revoke." }
    }

    private func resend(_ invitation: InvitationDTO) async {
        guard let client = model.api() else { return }
        actionError = nil
        do {
            let response = try await client.resendInvitation(id: invitation.id)
            if let token = response.token {
                link = "\(model.serverURL)/accept-invitation?token=\(token)"
            }
            await load()
        } catch {
            actionError = "Couldn't resend."
        }
    }
}
