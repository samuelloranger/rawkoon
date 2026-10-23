import SwiftUI

/// A settings row that leads somewhere: tinted icon tile, title, and an optional
/// second line saying what the destination holds or how it is set.
struct SettingsNavRow: View {
    let title: LocalizedStringKey
    var subtitle: String?
    let systemImage: String

    var body: some View {
        HStack(spacing: 12) {
            SettingsIconTile(systemImage: systemImage)
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .foregroundStyle(Theme.textStrong)
                if let subtitle, !subtitle.isEmpty {
                    Text(verbatim: subtitle)
                        .font(.footnote)
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                }
            }
        }
        .padding(.vertical, 2)
    }
}

struct SettingsIconTile: View {
    let systemImage: String

    var body: some View {
        Image(systemName: systemImage)
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(Theme.apricot)
            .frame(width: 30, height: 30)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(Theme.apricot.opacity(0.14))
            )
            .accessibilityHidden(true)
    }
}

/// The signed-in user at the top of Settings; it opens the Account screen.
struct SettingsProfileCard: View {
    let name: String?
    let email: String?
    let initials: String?
    var avatarURL: URL?
    let version: String?
    let isOffline: Bool

    var body: some View {
        HStack(spacing: 14) {
            SettingsAvatar(initials: initials, imageURL: avatarURL, size: 52)
            VStack(alignment: .leading, spacing: 2) {
                if let name, !name.isEmpty {
                    Text(verbatim: name)
                        .font(.headline)
                        .foregroundStyle(Theme.textStrong)
                } else {
                    Text("Account")
                        .font(.headline)
                        .foregroundStyle(Theme.textStrong)
                }
                if let email, !email.isEmpty {
                    Text(verbatim: email)
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                }
                connectionPill
                    .padding(.top, 4)
            }
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }

    private var connectionPill: some View {
        let tint = isOffline ? Theme.apricot : Theme.seed
        return HStack(spacing: 6) {
            Circle().fill(tint).frame(width: 6, height: 6)
            if isOffline {
                Text("Offline")
            } else if let version {
                Text("Connected \u{00B7} \(version)")
            } else {
                Text("Connected")
            }
        }
        .font(.caption.weight(.medium))
        .foregroundStyle(tint)
        .padding(.horizontal, 9)
        .padding(.vertical, 3)
        .background(Capsule().fill(tint.opacity(0.13)))
    }
}

struct SettingsAvatar: View {
    let initials: String?
    var imageURL: URL?
    let size: CGFloat

    var body: some View {
        ZStack {
            Circle().fill(LinearGradient(colors: [Theme.apricot, Theme.terracotta],
                                         startPoint: .topLeading, endPoint: .bottomTrailing))
            if let initials {
                Text(verbatim: initials)
                    .font(.system(size: size * 0.36, weight: .bold))
                    .foregroundStyle(Theme.onAccent)
            } else {
                Image(systemName: "person.fill")
                    .font(.system(size: size * 0.4, weight: .semibold))
                    .foregroundStyle(Theme.onAccent)
            }
        }
        .frame(width: size, height: size)
        .avatarPhoto(imageURL, size: size)
        .accessibilityHidden(true)
    }
}

extension View {
    /// The user's profile picture over an initials avatar, which stays visible while it loads or when there is none.
    func avatarPhoto(_ url: URL?, size: CGFloat) -> some View {
        overlay {
            if let url {
                CachedAsyncImage(url: url, targetSize: CGSize(width: size, height: size)) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Color.clear
                }
                .frame(width: size, height: size)
                .clipShape(Circle())
            }
        }
    }
}

extension View {
    /// The dark grouped-form look every settings screen shares.
    func settingsScreenStyle() -> some View {
        scrollContentBackground(.hidden)
            .readableWidth()
            .background(Theme.base)
            .tint(Theme.apricot)
    }
}

/// A settings screen's row: its icon and title, with a count badge when something needs attention.
struct SettingsDestinationRow: View {
    let destination: SettingsDestination
    var badge = 0

    var body: some View {
        HStack {
            Label(destination.title, systemImage: destination.systemImage)
            Spacer(minLength: 8)
            SettingsCountBadge(count: badge)
        }
    }
}

/// The small count that says how many open problems sit behind a row; nothing at zero.
struct SettingsCountBadge: View {
    let count: Int

    var body: some View {
        if count > 0 {
            Text(verbatim: count > 99 ? "99+" : String(count))
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(.white)
                .padding(.horizontal, 7)
                .frame(minWidth: 20, minHeight: 20)
                .background(Capsule().fill(Theme.badge))
                .accessibilityLabel(Text("\(count) open problems"))
        }
    }
}
