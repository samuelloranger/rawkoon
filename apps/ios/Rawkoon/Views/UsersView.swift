import SwiftUI

/// Admin-only list of registered users.
struct UsersView: View {
    @EnvironmentObject private var model: AppModel

    @State private var users: [AdminUser] = []
    @State private var loading = false
    @State private var errorText: String?
    @State private var isForbidden = false

    var body: some View {
        Group {
            if loading {
                ProgressView().tint(Theme.apricot)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Theme.base)
            } else if isForbidden {
                ContentUnavailableView(
                    "Admin only",
                    systemImage: "lock",
                    description: Text("You need admin access to view users.")
                )
                .background(Theme.base)
            } else if let errorText {
                ContentUnavailableView(
                    "Something went wrong",
                    systemImage: "exclamationmark.triangle",
                    description: Text(errorText)
                )
                .background(Theme.base)
            } else if users.isEmpty {
                ContentUnavailableView(
                    "No users",
                    systemImage: "person.2",
                    description: Text("No registered users found.")
                )
                .background(Theme.base)
            } else {
                VStack(spacing: 0) {
                    List {
                        ForEach(users) { user in
                            userRow(user)
                                .listRowBackground(Theme.raised)
                        }
                    }
                    .scrollContentBackground(.hidden)
                    .listStyle(.plain)

                    Text("\(users.count) users")
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(Theme.faint)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                }
                .background(Theme.base)
            }
        }
        .navigationTitle("Users")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func userRow(_ user: AdminUser) -> some View {
        let name = displayName(for: user)
        let showSubtitle = name != user.email

        return HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(name)
                        .font(.display(16))
                        .foregroundStyle(Theme.textStrong)
                        .lineLimit(1)
                    if user.isAdmin {
                        StatusBadge(text: "Admin", tint: Theme.muted)
                    }
                }
                if showSubtitle {
                    Text(user.email)
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                }
                Text(lastLoginText(user.lastLogin))
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Theme.faint)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
    }

    private func displayName(for user: AdminUser) -> String {
        let parts = [user.firstName, user.lastName].compactMap { $0 }.filter { !$0.isEmpty }
        if !parts.isEmpty {
            return parts.joined(separator: " ")
        }
        return user.email
    }

    private func lastLoginText(_ lastLogin: String?) -> String {
        guard let lastLogin, !lastLogin.isEmpty else { return "never" }
        return relativeTime(lastLogin) ?? lastLogin
    }

    private func relativeTime(_ isoString: String) -> String? {
        let formatterFraction = ISO8601DateFormatter()
        formatterFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let formatterPlain = ISO8601DateFormatter()
        formatterPlain.formatOptions = [.withInternetDateTime]

        guard let date = formatterFraction.date(from: isoString) ?? formatterPlain.date(from: isoString) else {
            return nil
        }

        let relativeFormatter = RelativeDateTimeFormatter()
        relativeFormatter.unitsStyle = .abbreviated
        return relativeFormatter.localizedString(for: date, relativeTo: Date())
    }

    private func load() async {
        loading = true
        errorText = nil
        isForbidden = false
        defer { loading = false }

        guard let client = model.api() else {
            errorText = "Not signed in."
            return
        }

        do {
            let response = try await client.adminUsers()
            users = response.users
        } catch APIError.unauthorized {
            isForbidden = true
        } catch let error as APIError {
            switch error {
            case let .http(status):
                errorText = "Server error (\(status))."
            case .decode:
                errorText = "Could not parse server response."
            case .transport:
                errorText = "Network error. Check your connection."
            case .unauthorized:
                isForbidden = true
            }
        } catch {
            errorText = "Network error. Check your connection."
        }
    }
}
