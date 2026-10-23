#if DEBUG
    import SwiftUI

    /// Debug harness entries for the admin Users screens (`RAWKOON_SCREEN=users…`).
    /// Each loads the real store, then shows the screen that a tap would reach.
    struct DebugUsersScreen: View {
        /// `users`, `userDetail`, `usersInvite`, `usersImport` or `invitations`.
        let screen: String
        @Environment(AppModel.self) private var model
        @State private var store = UsersAdminStore()
        @State private var loaded = false

        var body: some View {
            NavigationStack {
                Group {
                    if loaded {
                        content
                    } else {
                        ProgressView().tint(Theme.muted)
                    }
                }
            }
            .task {
                await store.load(model)
                loaded = true
            }
        }

        @ViewBuilder private var content: some View {
            switch screen {
            case "userDetail":
                if let user = store.users.first(where: { $0.id != model.userId && $0.jellyfinUserId != nil })
                    ?? store.users.first(where: { $0.id != model.userId })
                {
                    UserAdminDetailView(store: store, userId: user.id)
                } else {
                    Text(verbatim: "No other user")
                }
            case "usersInvite": InviteUserSheet(store: store)
            case "usersImport": ImportJellyfinSheet(store: store)
            case "invitations": InvitationsAdminView(store: store)
            default: UsersAdminView()
            }
        }
    }
#endif
