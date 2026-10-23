import RawkoonKit
import SwiftUI

/// One person's screen: everything the web table offers on a row, in one place.
struct UserAdminDetailView: View {
    let store: UsersAdminStore
    let userId: String

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var resetting = false
    @State private var newPassword = ""

    var body: some View {
        Group {
            if let user = store.user(id: userId) {
                form(user)
            } else {
                ContentUnavailableView("This account no longer exists", systemImage: "person.slash")
                    .rawkoonLivingSymbol(.empty)
            }
        }
        .navigationBarTitleDisplayMode(.inline)
    }

    private func form(_ user: AdminUser) -> some View {
        let isYou = user.id == model.userId
        return Form {
            Section { hero(user, isYou: isYou) }
                .listRowBackground(Color.clear)

            Section("Role") {
                if isYou {
                    LabeledContent(user.isAdmin ? String(localized: "Admin") : String(localized: "User")) {
                        Text("You can't change your own role").foregroundStyle(Theme.muted)
                    }
                } else {
                    Picker("Role", selection: roleBinding(user)) {
                        Text("User").tag(false)
                        Text("Admin").tag(true)
                    }
                    .pickerStyle(.segmented)
                    .disabled(store.busyIds.contains(user.id))
                    .requiresConnection(model.isOffline)
                }
            }
            .listRowBackground(Theme.raised)

            if store.jellyfinState != .notConfigured {
                jellyfinSection(user)
            }

            Section("Account") {
                LabeledContent("Joined", value: formattedDate(user.createdAt) ?? "—")
                if let language = languageName(user.locale) {
                    LabeledContent("Language", value: language)
                }
                if isYou {
                    NavigationLink("Edit your profile") { ProfileView() }
                } else {
                    Button("Reset password…") {
                        newPassword = ""
                        resetting = true
                    }
                    .requiresConnection(model.isOffline)
                }
            }
            .listRowBackground(Theme.raised)

            if !isYou {
                Section {
                    Button("Delete \(store.displayName(user))…", role: .destructive) { confirmDelete(user) }
                        .requiresConnection(model.isOffline)
                }
                .listRowBackground(Theme.raised)
            }
        }
        .scrollContentBackground(.hidden)
        .readableWidth()
        .background(Theme.base)
        .tint(Theme.apricot)
        .alert("Reset password", isPresented: $resetting) {
            SecureField("New password (min 8)", text: $newPassword)
            Button("Reset") {
                let password = newPassword
                Task { await store.resetPassword(user, to: password, model: model) }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Sets a new password and signs \(store.displayName(user)) out everywhere.")
        }
    }

    private func hero(_ user: AdminUser, isYou: Bool) -> some View {
        VStack(spacing: 6) {
            SettingsAvatar(
                initials: UserInitials.from(firstName: user.firstName, lastName: user.lastName, name: store.displayName(user)),
                imageURL: model.absoluteURL(user.avatarUrl),
                size: 84
            )
            Text(verbatim: store.displayName(user))
                .font(.display(26, weight: .semibold))
                .foregroundStyle(Theme.textStrong)
                .multilineTextAlignment(.center)
                .padding(.top, 6)
            Text(AdminUserDisplay.isPlaceholderEmail(user.email) ? String(localized: "Signs in with Jellyfin") : user.email)
                .font(.footnote)
                .foregroundStyle(Theme.muted)
            Text(lastSignIn(user, isYou: isYou))
                .font(.footnote)
                .foregroundStyle(Theme.text)
                .padding(.top, 2)
        }
        .frame(maxWidth: .infinity)
    }

    private func jellyfinSection(_ user: AdminUser) -> some View {
        Section {
            if store.jellyfinState == .ready {
                Picker("Linked account", selection: linkBinding(user)) {
                    Text("Not linked").tag(String?.none)
                    ForEach(store.jellyfinUsers) { jellyfinUser in
                        Text(jellyfinOptionLabel(jellyfinUser, for: user))
                            .tag(Optional(jellyfinUser.id))
                            .selectionDisabled(!isLinkable(jellyfinUser, for: user))
                    }
                }
                .disabled(store.busyIds.contains(user.id))
                .requiresConnection(model.isOffline)
            } else {
                LabeledContent("Linked account", value: store.jellyfinName(for: user) ?? (user.jellyfinUserId == nil
                        ? String(localized: "Not linked")
                        : String(localized: "Linked")))
            }
        } header: {
            Text(verbatim: "Jellyfin")
        } footer: {
            if store.jellyfinState == .unreachable {
                Text("Can't reach Jellyfin, so the link can't be changed right now.")
            } else {
                Text("Changing the link signs out this person's Jellyfin sessions.")
            }
        }
        .listRowBackground(Theme.raised)
    }

    // MARK: Bindings and actions

    private func roleBinding(_ user: AdminUser) -> Binding<Bool> {
        Binding(get: { user.isAdmin }, set: { wantsAdmin in
            guard wantsAdmin != user.isAdmin else { return }
            let name = store.displayName(user)
            model.pendingConfirm = ConfirmRequest(
                title: wantsAdmin ? String(localized: "Make \(name) an admin?") : String(localized: "Make \(name) a user?"),
                message: wantsAdmin
                    ? String(localized: "They get access to every server setting, including users.")
                    : String(localized: "They lose access to server settings."),
                confirmTitle: wantsAdmin ? String(localized: "Make admin") : String(localized: "Make user"),
                isDestructive: false,
                action: { Task { await store.setRole(user, isAdmin: wantsAdmin, model: model) } }
            )
        })
    }

    private func linkBinding(_ user: AdminUser) -> Binding<String?> {
        Binding(get: { user.jellyfinUserId }, set: { newId in
            guard newId != user.jellyfinUserId else { return }
            Task { await store.link(user, to: newId, model: model) }
        })
    }

    private func isLinkable(_ jellyfinUser: AdminJellyfinUser, for user: AdminUser) -> Bool {
        if jellyfinUser.id == user.jellyfinUserId {
            return true
        }
        return jellyfinUser.disabled != true && jellyfinUser.linkedUserId == nil
    }

    private func jellyfinOptionLabel(_ jellyfinUser: AdminJellyfinUser, for user: AdminUser) -> String {
        if jellyfinUser.id == user.jellyfinUserId {
            return jellyfinUser.name
        }
        if let owner = jellyfinUser.linkedUserId.flatMap({ store.user(id: $0) }) {
            return String(localized: "\(jellyfinUser.name) (linked to \(store.displayName(owner)))")
        }
        if jellyfinUser.disabled == true {
            return String(localized: "\(jellyfinUser.name) (disabled in Jellyfin)")
        }
        return jellyfinUser.name
    }

    private func confirmDelete(_ user: AdminUser) {
        let name = store.displayName(user)
        model.pendingConfirm = ConfirmRequest(
            title: String(localized: "Delete \(name)?"),
            message: String(localized: "They lose access right away. Their requests and history stay."),
            confirmTitle: String(localized: "Delete"),
            action: {
                Task {
                    if await store.delete(user, model: model) {
                        dismiss()
                    }
                }
            }
        )
    }

    // MARK: Formatting

    private func lastSignIn(_ user: AdminUser, isYou: Bool) -> String {
        if isYou {
            return String(localized: "Signed in on this device")
        }
        guard let raw = user.lastLogin, let date = APIClient.parseISO8601(raw) else {
            return String(localized: "Never signed in")
        }
        return String(localized: "Last signed in \(date.formatted(.relative(presentation: .named)))")
    }

    private func formattedDate(_ raw: String?) -> String? {
        guard let raw, let date = APIClient.parseISO8601(raw) else { return nil }
        return date.formatted(date: .abbreviated, time: .omitted)
    }

    private func languageName(_ code: String?) -> String? {
        guard let code, !code.isEmpty else { return nil }
        return Locale.current.localizedString(forLanguageCode: code)?.localizedCapitalized
    }
}
