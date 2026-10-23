import SwiftUI

/// Invitations, open ones first. A pending or expired invite can get a new link; a pending one can be revoked.
struct InvitationsAdminView: View {
    let store: UsersAdminStore

    @Environment(AppModel.self) private var model

    private var open: [InvitationDTO] {
        store.invitations.filter { $0.status == "pending" }
    }

    private var past: [InvitationDTO] {
        store.invitations.filter { $0.status != "pending" }
    }

    var body: some View {
        Form {
            if store.invitations.isEmpty {
                Section {
                    Text("No invitations yet. Use + on Users to invite someone with a link.")
                        .foregroundStyle(Theme.muted)
                }
                .listRowBackground(Theme.raised)
            }
            if !open.isEmpty {
                Section("Pending") { rows(open) }
            }
            if !past.isEmpty {
                Section {
                    rows(past)
                } header: {
                    Text("Past")
                } footer: {
                    Text("Swipe an invitation for a new link. A new link is copied right away.")
                }
            }
        }
        .scrollContentBackground(.hidden)
        .readableWidth()
        .background(Theme.base)
        .tint(Theme.apricot)
        .navigationTitle("Invitations")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await store.loadInvitations(model) }
        .task { await store.loadInvitations(model) }
    }

    private func rows(_ invitations: [InvitationDTO]) -> some View {
        ForEach(invitations) { invitation in
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: invitation.email).foregroundStyle(Theme.textStrong).lineLimit(1)
                    Text(detail(invitation)).font(.footnote).foregroundStyle(Theme.muted)
                }
                Spacer(minLength: 8)
                LocalizedStatus.text(invitation.status)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(tint(invitation.status))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(Capsule().fill(tint(invitation.status).opacity(0.14)))
            }
            .listRowBackground(Theme.raised)
            .swipeActions {
                if invitation.status == "pending" {
                    Button("Revoke", role: .destructive) { confirmRevoke(invitation) }
                        .requiresConnection(model.isOffline)
                }
                if invitation.status == "pending" || invitation.status == "expired" {
                    Button("New link") { Task { await store.renew(invitation, model: model) } }
                        .tint(Theme.apricot)
                        .requiresConnection(model.isOffline)
                }
            }
        }
    }

    private func detail(_ invitation: InvitationDTO) -> String {
        let sent = date(invitation.createdAt)
        let expires = date(invitation.expiresAt)
        switch invitation.status {
        case "pending":
            if let sent, let expires {
                return String(localized: "Sent \(sent), expires \(expires)")
            }
            return expires.map { String(localized: "Expires \($0)") } ?? ""
        case "expired":
            return expires.map { String(localized: "Expired \($0)") } ?? ""
        default:
            return sent.map { String(localized: "Sent \($0)") } ?? ""
        }
    }

    private func date(_ raw: String?) -> String? {
        guard let raw, let date = APIClient.parseISO8601(raw) else { return nil }
        return date.formatted(date: .abbreviated, time: .omitted)
    }

    private func tint(_ status: String) -> Color {
        switch status {
        case "pending": Theme.apricot
        case "accepted": Theme.seed
        default: Theme.muted
        }
    }

    private func confirmRevoke(_ invitation: InvitationDTO) {
        model.pendingConfirm = ConfirmRequest(
            title: String(localized: "Revoke the invitation for \(invitation.email)?"),
            message: String(localized: "The link stops working right away."),
            confirmTitle: String(localized: "Revoke"),
            action: { Task { await store.revoke(invitation, model: model) } }
        )
    }
}
