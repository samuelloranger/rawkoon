import RawkoonKit
import SwiftUI

private let languageOptions: [(value: String, label: LocalizedStringKey)] = [("en", "English"), ("fr", "French")]

/// Invite with a link: the form becomes the link, ready to copy or share.
struct InviteUserSheet: View {
    let store: UsersAdminStore

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var locale = "en"
    @State private var makeAdmin = false
    @State private var link: String?
    @State private var working = false
    @State private var error: String?

    var body: some View {
        Form {
            if let link {
                linkSection(link)
            } else {
                Section {
                    LabeledTextFieldRow(title: "Email", text: $email, keyboard: .emailAddress)
                    PickerRow(title: "Language", selection: $locale, options: languageOptions)
                    ToggleRow("Admin", isOn: $makeAdmin)
                } footer: {
                    Text("Creates a link that works once and expires in 7 days.")
                }
            }
            if let error {
                Section { Text(error).foregroundStyle(Theme.terracotta) }.listRowBackground(Theme.raised)
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.base)
        .tint(Theme.apricot)
        .navigationTitle("Invite with a link")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button(link == nil ? "Cancel" : "Done") { dismiss() }
            }
            ToolbarItem(placement: .topBarTrailing) {
                if working {
                    ProgressView().tint(Theme.apricot)
                } else if link == nil {
                    Button("Create link") { Task { await create() } }
                        .fontWeight(.semibold)
                        .disabled(email.trimmingCharacters(in: .whitespaces).isEmpty)
                        .requiresConnection(model.isOffline)
                }
            }
        }
    }

    private func linkSection(_ link: String) -> some View {
        Section {
            Text(verbatim: link)
                .font(.footnote.monospaced())
                .foregroundStyle(Theme.text)
                .textSelection(.enabled)
            Button {
                UIPasteboard.general.string = link
                model.toast(String(localized: "Link copied."), style: .success)
            } label: {
                Label("Copy link", systemImage: "doc.on.doc")
            }
            if let url = URL(string: link) {
                ShareLink(item: url) { Label("Share…", systemImage: "square.and.arrow.up") }
            }
        } header: {
            Text("Link for \(email)")
        } footer: {
            Text("Works once and expires in 7 days.")
        }
        .listRowBackground(Theme.raised)
    }

    private func create() async {
        guard let client = model.api() else { return }
        working = true; error = nil
        defer { working = false }
        do {
            let response = try await client.createInvitation(
                CreateInvitationBody(email: email.trimmingCharacters(in: .whitespaces), locale: locale, isAdmin: makeAdmin)
            )
            if let token = response.token {
                link = UsersAdminStore.inviteLink(server: model.serverURL, token: token)
            }
            await store.loadInvitations(model)
        } catch {
            self.error = String(localized: "Couldn't create the invitation. Check the email and try again.")
        }
    }
}

/// Create an account directly, with a password the admin sets.
struct CreateUserSheet: View {
    let store: UsersAdminStore

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var firstName = ""
    @State private var lastName = ""
    @State private var password = ""
    @State private var locale = "en"
    @State private var makeAdmin = false
    @State private var working = false
    @State private var error: String?

    private var ready: Bool {
        !email.trimmingCharacters(in: .whitespaces).isEmpty && password.count >= 8
    }

    var body: some View {
        Form {
            Section {
                LabeledTextFieldRow(title: "Email", text: $email, keyboard: .emailAddress)
                LabeledTextFieldRow(title: "First name", text: $firstName, autocaps: true)
                LabeledTextFieldRow(title: "Last name", text: $lastName, autocaps: true)
                SecretFieldRow(title: "Password (min 8)", input: $password)
            }
            Section {
                PickerRow(title: "Language", selection: $locale, options: languageOptions)
                ToggleRow("Admin", isOn: $makeAdmin)
            }
            if let error {
                Section { Text(error).foregroundStyle(Theme.terracotta) }.listRowBackground(Theme.raised)
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.base)
        .tint(Theme.apricot)
        .navigationTitle("Create an account")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { Button("Cancel") { dismiss() } }
            ToolbarItem(placement: .topBarTrailing) {
                if working {
                    ProgressView().tint(Theme.apricot)
                } else {
                    Button("Create") { Task { await create() } }
                        .fontWeight(.semibold)
                        .disabled(!ready)
                        .requiresConnection(model.isOffline)
                }
            }
        }
    }

    private func create() async {
        guard let client = model.api() else { return }
        working = true; error = nil
        defer { working = false }
        do {
            try await client.createUser(CreateUserBody(
                email: email.trimmingCharacters(in: .whitespaces), password: password,
                firstName: firstName.isEmpty ? nil : firstName,
                lastName: lastName.isEmpty ? nil : lastName,
                locale: locale, isAdmin: makeAdmin
            ))
            await store.load(model)
            model.toast(String(localized: "Account created."), style: .success)
            dismiss()
        } catch {
            self.error = String(localized: "Couldn't create the account. The email may already be in use.")
        }
    }
}

/// Import from Jellyfin: same rules as the web dialog.
struct ImportJellyfinSheet: View {
    let store: UsersAdminStore

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var selected: Set<String> = []
    @State private var admins: Set<String> = []
    @State private var working = false

    var body: some View {
        Form {
            Section {
                ForEach(store.jellyfinUsers) { jellyfinUser in
                    row(jellyfinUser)
                }
            } footer: {
                Text("Each person gets a Rawkoon account linked to their Jellyfin user. They sign in with Jellyfin; no password is set.")
            }
            .listRowBackground(Theme.raised)
        }
        .scrollContentBackground(.hidden)
        .background(Theme.base)
        .tint(Theme.apricot)
        .navigationTitle("Import from Jellyfin")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { Button("Cancel") { dismiss() } }
            ToolbarItem(placement: .topBarTrailing) {
                if working {
                    ProgressView().tint(Theme.apricot)
                } else {
                    Button(selected.isEmpty ? String(localized: "Import") : String(localized: "Import \(selected.count)")) {
                        Task { await runImport() }
                    }
                    .fontWeight(.semibold)
                    .disabled(selected.isEmpty)
                    .requiresConnection(model.isOffline)
                }
            }
        }
    }

    private func row(_ jellyfinUser: AdminJellyfinUser) -> some View {
        let reason = blockedReason(jellyfinUser)
        let isOn = selected.contains(jellyfinUser.id)
        return HStack(spacing: 12) {
            Button {
                if isOn {
                    selected.remove(jellyfinUser.id); admins.remove(jellyfinUser.id)
                } else {
                    selected.insert(jellyfinUser.id)
                }
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: isOn ? "checkmark.circle.fill" : "circle")
                        .font(.title3)
                        .foregroundStyle(isOn ? Theme.apricot : Theme.faint)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(verbatim: jellyfinUser.name).foregroundStyle(Theme.textStrong)
                        if let reason {
                            Text(reason).font(.footnote).foregroundStyle(Theme.muted)
                        }
                    }
                    Spacer(minLength: 8)
                }
                .contentShape(Rectangle())
                .accessibilityElement(children: .combine)
            }
            .buttonStyle(.plain)
            .disabled(reason != nil)
            .accessibilityAddTraits(isOn ? .isSelected : [])
            if isOn {
                Menu {
                    Picker("Role", selection: roleBinding(jellyfinUser.id)) {
                        Text("User").tag(false)
                        Text("Admin").tag(true)
                    }
                } label: {
                    HStack(spacing: 3) {
                        Text(LocalizedStringKey(admins.contains(jellyfinUser.id) ? "Admin" : "User"))
                        Image(systemName: "chevron.up.chevron.down").font(.caption2)
                    }
                    .font(.footnote.weight(.medium))
                }
            }
        }
        .opacity(reason == nil ? 1 : 0.5)
    }

    private func roleBinding(_ id: String) -> Binding<Bool> {
        Binding(get: { admins.contains(id) }, set: { isAdmin in
            if isAdmin {
                admins.insert(id)
            } else {
                admins.remove(id)
            }
        })
    }

    private func blockedReason(_ jellyfinUser: AdminJellyfinUser) -> String? {
        if jellyfinUser.disabled == true {
            return String(localized: "Disabled in Jellyfin")
        }
        if let owner = jellyfinUser.linkedUserId {
            let name = store.user(id: owner).map { store.displayName($0) }
            return name.map { String(localized: "Already linked to \($0)") } ?? String(localized: "Already linked")
        }
        return nil
    }

    private func runImport() async {
        guard let client = model.api() else { return }
        working = true
        defer { working = false }
        let entries = store.jellyfinUsers
            .filter { selected.contains($0.id) }
            .map { ImportJellyfinUsersBody.Entry(jellyfinUserId: $0.id, isAdmin: admins.contains($0.id)) }
        do {
            let result = try await client.importJellyfinUsers(ImportJellyfinUsersBody(users: entries))
            await store.load(model)
            if result.skipped.isEmpty {
                model.toast(String(localized: "Imported \(result.created.count)."), style: .success)
            } else {
                let names = result.skipped.map { skip in
                    let name = store.jellyfinUsers.first { $0.id == skip.jellyfinUserId }?.name ?? skip.jellyfinUserId
                    return "\(name) (\(Self.skipReason(skip.reason)))"
                }
                model.toast(
                    String(localized: "Imported \(result.created.count). Skipped: \(names.joined(separator: ", "))."),
                    style: .info
                )
            }
            dismiss()
        } catch {
            model.toast(String(localized: "Couldn't import from Jellyfin."), style: .error)
        }
    }

    private static func skipReason(_ code: String) -> String {
        switch code {
        case "disabled": String(localized: "disabled in Jellyfin")
        case "already_linked": String(localized: "already linked")
        case "not_found": String(localized: "no longer in Jellyfin")
        case "duplicate": String(localized: "listed twice")
        default: String(localized: "not imported")
        }
    }
}
