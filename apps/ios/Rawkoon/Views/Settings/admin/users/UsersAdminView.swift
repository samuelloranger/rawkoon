import RawkoonKit
import SwiftUI

/// Users admin (admin): everyone with a Rawkoon account, grouped by role, plus invitations
/// and the three ways to add someone. Each person opens on their own screen.
struct UsersAdminView: View {
    @Environment(AppModel.self) private var model
    @State private var store = UsersAdminStore()
    @State private var search = ""
    @State private var sheet: AddSheet?

    enum AddSheet: String, Identifiable {
        case invite, create, importJellyfin
        var id: String {
            rawValue
        }
    }

    var body: some View {
        Group {
            if !model.isAdmin {
                ContentUnavailableView("Admin only", systemImage: "lock")
                    .rawkoonLivingSymbol(.empty)
            } else {
                list
            }
        }
        .navigationTitle("Users")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var filtered: [AdminUser] {
        store.users
            .filter { AdminUserDisplay.matches(search, firstName: $0.firstName, lastName: $0.lastName, email: $0.email) }
            .sorted { store.displayName($0).localizedStandardCompare(store.displayName($1)) == .orderedAscending }
    }

    private var list: some View {
        Form {
            SettingsStateView(
                isLoading: store.loading && store.users.isEmpty,
                error: store.loadError,
                retry: { Task { await store.load(model) } }
            ) {
                let admins = filtered.filter(\.isAdmin)
                let members = filtered.filter { !$0.isAdmin }
                if !admins.isEmpty {
                    Section("Admins") { rows(admins) }
                }
                if !members.isEmpty {
                    Section("Users") { rows(members) }
                }
                if filtered.isEmpty, !search.isEmpty {
                    Text("No one matches “\(search)”.")
                        .foregroundStyle(Theme.muted)
                        .listRowBackground(Theme.raised)
                }
                Section("Invitations") {
                    NavigationLink {
                        InvitationsAdminView(store: store)
                    } label: {
                        Text(invitationSummary).foregroundStyle(Theme.text)
                    }
                    .listRowBackground(Theme.raised)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .readableWidth()
        .background(Theme.base)
        .tint(Theme.apricot)
        .modifier(PeopleSearch(enabled: store.users.count > AdminUserDisplay.searchThreshold, text: $search))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { addMenu }
        }
        .sheet(item: $sheet) { which in
            NavigationStack {
                switch which {
                case .invite: InviteUserSheet(store: store)
                case .create: CreateUserSheet(store: store)
                case .importJellyfin: ImportJellyfinSheet(store: store)
                }
            }
        }
        .refreshable { await store.load(model) }
        .task { await store.load(model) }
    }

    private func rows(_ users: [AdminUser]) -> some View {
        ForEach(users) { user in
            let isYou = user.id == model.userId
            NavigationLink {
                UserAdminDetailView(store: store, userId: user.id)
            } label: {
                AdminUserRow(user: user, store: store, isYou: isYou)
            }
            .listRowBackground(Theme.raised)
            .swipeActions {
                if !isYou {
                    Button("Delete", role: .destructive) { confirmDelete(user) }
                        .requiresConnection(model.isOffline)
                    Button(LocalizedStringKey(user.isAdmin ? "Make user" : "Make admin")) { confirmRole(user) }
                        .tint(Theme.apricot)
                        .requiresConnection(model.isOffline)
                }
            }
        }
    }

    private var addMenu: some View {
        Menu {
            Button { sheet = .invite } label: { Label("Invite with a link", systemImage: "envelope") }
            Button { sheet = .create } label: { Label("Create an account", systemImage: "person.badge.plus") }
            if store.jellyfinState == .ready {
                Button { sheet = .importJellyfin } label: {
                    Label { Text("Import from Jellyfin") } icon: { Image("JellyfinLogo") }
                }
            }
        } label: {
            Image(systemName: "plus")
        }
        .accessibilityLabel("Add people")
        .requiresConnection(model.isOffline)
    }

    private var invitationSummary: String {
        let pending = store.invitations.filter { $0.status == "pending" }.count
        let expired = store.invitations.filter { $0.status == "expired" }.count
        switch (pending, expired) {
        case (0, 0): return String(localized: "No open invitations")
        case (_, 0): return String(localized: "\(pending) pending")
        case (0, _): return String(localized: "\(expired) expired")
        default: return String(localized: "\(pending) pending, \(expired) expired")
        }
    }

    private func confirmDelete(_ user: AdminUser) {
        let name = store.displayName(user)
        model.pendingConfirm = ConfirmRequest(
            title: String(localized: "Delete \(name)?"),
            message: String(localized: "They lose access right away. Their requests and history stay."),
            confirmTitle: String(localized: "Delete"),
            action: { Task { await store.delete(user, model: model) } }
        )
    }

    private func confirmRole(_ user: AdminUser) {
        let name = store.displayName(user)
        model.pendingConfirm = ConfirmRequest(
            title: user.isAdmin ? String(localized: "Make \(name) a user?") : String(localized: "Make \(name) an admin?"),
            message: user.isAdmin
                ? String(localized: "They lose access to server settings.")
                : String(localized: "They get access to every server setting, including users."),
            confirmTitle: user.isAdmin ? String(localized: "Make user") : String(localized: "Make admin"),
            isDestructive: false,
            action: { Task { await store.setRole(user, isAdmin: !user.isAdmin, model: model) } }
        )
    }
}

/// One person in the list: picture, name, Jellyfin mark, and when they last signed in.
struct AdminUserRow: View {
    let user: AdminUser
    let store: UsersAdminStore
    let isYou: Bool
    @Environment(AppModel.self) private var model

    var body: some View {
        HStack(spacing: 12) {
            SettingsAvatar(
                initials: UserInitials.from(firstName: user.firstName, lastName: user.lastName, name: store.displayName(user)),
                imageURL: model.absoluteURL(user.avatarUrl),
                size: 38
            )
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    Text(verbatim: store.displayName(user))
                        .foregroundStyle(Theme.textStrong)
                        .lineLimit(1)
                    if user.jellyfinUserId != nil {
                        Image("JellyfinLogo")
                            .resizable()
                            .frame(width: 13, height: 13)
                            .accessibilityLabel("Linked to Jellyfin")
                    }
                    if isYou {
                        Text("You")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(Theme.apricot)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 1)
                            .overlay(Capsule().strokeBorder(Theme.apricot.opacity(0.45)))
                    }
                }
                Text(subtitle)
                    .font(.footnote)
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            if store.busyIds.contains(user.id) {
                ProgressView().tint(Theme.muted)
            } else {
                Text(lastSeen)
                    .font(.caption)
                    .foregroundStyle(Theme.faint)
            }
        }
        .padding(.vertical, 2)
    }

    private var subtitle: String {
        AdminUserDisplay.isPlaceholderEmail(user.email) ? String(localized: "Signs in with Jellyfin") : user.email
    }

    private var lastSeen: String {
        guard let raw = user.lastLogin, let date = APIClient.parseISO8601(raw) else {
            return String(localized: "Never")
        }
        return date.formatted(.relative(presentation: .named, unitsStyle: .abbreviated))
    }
}

/// Search appears only once the list is long enough to need it.
private struct PeopleSearch: ViewModifier {
    let enabled: Bool
    @Binding var text: String

    func body(content: Content) -> some View {
        if enabled {
            content.searchable(text: $text, prompt: Text("Search people"))
        } else {
            content
        }
    }
}
