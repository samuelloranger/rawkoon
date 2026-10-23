import RawkoonKit
import SwiftUI

/// Shared state for the admin Users screens: the list, each person's screen and the sheets read and change it.
@MainActor
@Observable
final class UsersAdminStore {
    enum JellyfinState: Equatable {
        case unknown, notConfigured, unreachable, ready
    }

    private(set) var users: [AdminUser] = []
    private(set) var jellyfinUsers: [AdminJellyfinUser] = []
    private(set) var jellyfinState: JellyfinState = .unknown
    private(set) var invitations: [InvitationDTO] = []
    private(set) var loading = true
    private(set) var loadError: String?
    private(set) var busyIds: Set<String> = []
    private(set) var busyInvitationIds: Set<Int> = []
    /// Deleted ids stay hidden until the server confirms, so a refresh racing the delete can't bring a row back.
    private var pendingDeletes: Set<String> = []
    private var loadGen = 0

    func user(id: String) -> AdminUser? {
        users.first { $0.id == id }
    }

    func jellyfinName(for user: AdminUser) -> String? {
        guard let id = user.jellyfinUserId else { return nil }
        return jellyfinUsers.first { $0.id == id }?.name
    }

    // MARK: Loading

    func load(_ model: AppModel) async {
        guard let client = model.api() else { loading = false; return }
        loadError = nil
        let gen = loadGen
        do {
            let fetched = try await client.adminUsers().users
            if gen == loadGen {
                users = fetched.filter { !pendingDeletes.contains($0.id) }
            }
        } catch {
            if users.isEmpty {
                loadError = settingsErrorMessage(error)
            }
        }
        loading = false
        await loadJellyfin(client)
        await loadInvitations(model)
    }

    func loadInvitations(_ model: AppModel) async {
        guard let client = model.api() else { return }
        if let fetched = try? await client.invitations().invitations {
            invitations = fetched
        }
    }

    private func loadJellyfin(_ client: APIClient) async {
        do {
            jellyfinUsers = try await client.adminJellyfinUsers().users
            jellyfinState = .ready
        } catch APIError.server(status: 503, message: _), APIError.http(503) {
            jellyfinUsers = []
            jellyfinState = .notConfigured
        } catch {
            jellyfinState = .unreachable
        }
    }

    // MARK: People

    func setRole(_ user: AdminUser, isAdmin: Bool, model: AppModel) async {
        guard let client = model.api(), !busyIds.contains(user.id) else { return }
        busyIds.insert(user.id)
        defer { busyIds.remove(user.id) }
        let name = displayName(user)
        do {
            try await client.setUserRole(id: user.id, isAdmin: isAdmin)
            await load(model)
            model.toast(
                isAdmin ? String(localized: "\(name) is now an admin.") : String(localized: "\(name) is now a user."),
                style: .success
            )
        } catch {
            model.toast(settingsErrorMessage(error), style: .error)
        }
    }

    /// Returns true once the account is gone, so a person's screen can close itself.
    @discardableResult
    func delete(_ user: AdminUser, model: AppModel) async -> Bool {
        guard let client = model.api(), !busyIds.contains(user.id) else { return false }
        busyIds.insert(user.id)
        defer { busyIds.remove(user.id) }
        loadGen &+= 1
        guard let idx = users.firstIndex(where: { $0.id == user.id }) else { return false }
        let removed = users.remove(at: idx)
        pendingDeletes.insert(user.id)
        defer { pendingDeletes.remove(user.id) }
        do {
            try await client.deleteUser(id: user.id)
            model.toast(String(localized: "Deleted \(displayName(user))."), style: .success)
            return true
        } catch {
            if !users.contains(where: { $0.id == removed.id }) {
                users.insert(removed, at: min(idx, users.count))
            }
            model.toast(String(localized: "Couldn't delete \(displayName(user))."), style: .error)
            return false
        }
    }

    func link(_ user: AdminUser, to jellyfinUserId: String?, model: AppModel) async {
        guard let client = model.api(), !busyIds.contains(user.id) else { return }
        busyIds.insert(user.id)
        defer { busyIds.remove(user.id) }
        do {
            try await client.linkJellyfinUser(userId: user.id, jellyfinUserId: jellyfinUserId)
            await load(model)
            model.toast(String(localized: "Jellyfin link updated."), style: .success)
        } catch APIError.server(status: 409, message: _), APIError.http(409) {
            await load(model)
            model.toast(String(localized: "That Jellyfin user is linked to someone else."), style: .error)
        } catch {
            model.toast(settingsErrorMessage(error), style: .error)
        }
    }

    func resetPassword(_ user: AdminUser, to password: String, model: AppModel) async {
        guard let client = model.api() else { return }
        guard password.count >= 8 else {
            model.toast(String(localized: "Password must be at least 8 characters."), style: .error)
            return
        }
        do {
            try await client.resetUserPassword(id: user.id, newPassword: password)
            model.toast(String(localized: "Password reset for \(displayName(user))."), style: .success)
        } catch {
            model.toast(String(localized: "Couldn't reset password."), style: .error)
        }
    }

    // MARK: Invitations

    func revoke(_ invitation: InvitationDTO, model: AppModel) async {
        guard let client = model.api(), !busyInvitationIds.contains(invitation.id) else { return }
        busyInvitationIds.insert(invitation.id)
        defer { busyInvitationIds.remove(invitation.id) }
        do {
            try await client.revokeInvitation(id: invitation.id)
            await loadInvitations(model)
            model.toast(String(localized: "Invitation revoked."), style: .success)
        } catch {
            model.toast(String(localized: "Couldn't revoke."), style: .error)
        }
    }

    /// Issues a new link for a pending or expired invitation and copies it.
    func renew(_ invitation: InvitationDTO, model: AppModel) async {
        guard let client = model.api(), !busyInvitationIds.contains(invitation.id) else { return }
        busyInvitationIds.insert(invitation.id)
        defer { busyInvitationIds.remove(invitation.id) }
        do {
            let response = try await client.resendInvitation(id: invitation.id)
            if let token = response.token {
                UIPasteboard.general.string = Self.inviteLink(server: model.serverURL, token: token)
                model.toast(String(localized: "New link copied."), style: .success)
            } else {
                model.toast(String(localized: "The invitation was renewed, but no link came back."), style: .info)
            }
            await loadInvitations(model)
        } catch {
            model.toast(String(localized: "Couldn't create a new link."), style: .error)
        }
    }

    static func inviteLink(server: String, token: String) -> String {
        "\(server)/accept-invitation?token=\(token)"
    }

    // MARK: Presentation

    func displayName(_ user: AdminUser) -> String {
        AdminUserDisplay.name(firstName: user.firstName, lastName: user.lastName, email: user.email)
            ?? jellyfinName(for: user)
            ?? String(localized: "Jellyfin user")
    }
}
