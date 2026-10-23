import Foundation

// Management, account, and admin DTOs.

nonisolated struct Indexer: Decodable, Identifiable, Sendable {
    let id: Int
    let slug: String
    let name: String
    let protocolType: String?
    let enabled: Bool
    let privacy: String?

    enum CodingKeys: String, CodingKey {
        case id, slug, name, enabled, privacy
        case protocolType = "protocol"
    }
}

nonisolated struct IndexersResponse: Decodable, Sendable {
    let indexers: [Indexer]
}

nonisolated struct DownloadClientIntegration: Decodable, Sendable {
    let enabled: Bool
    let clientType: String?
    let websiteUrl: String?
    let username: String?
    let passwordSet: Bool?
    let label: String?
    let savePath: String?
}

nonisolated struct DownloadClientResponse: Decodable, Sendable {
    let integration: DownloadClientIntegration
}

nonisolated struct AdminUser: Decodable, Identifiable, Sendable {
    let id: String
    let email: String
    let firstName: String?
    let lastName: String?
    let isAdmin: Bool
    let locale: String?
    let createdAt: String?
    let lastLogin: String?
    let jellyfinUserId: String?
    let avatarUrl: String?
}

/// A Jellyfin user offered for linking or import (`GET /api/admin/jellyfin-users`).
nonisolated struct AdminJellyfinUser: Decodable, Identifiable, Sendable {
    let id: String
    let name: String
    let disabled: Bool?
    /// The Rawkoon user already tied to this Jellyfin user, if any.
    let linkedUserId: String?
}

nonisolated struct AdminJellyfinUsersResponse: Decodable, Sendable { let users: [AdminJellyfinUser] }

/// `jellyfin_user_id` must be sent even when nil: the server reads null as "unlink".
nonisolated struct LinkJellyfinUserBody: Encodable, Sendable {
    let jellyfinUserId: String?

    private enum CodingKeys: String, CodingKey { case jellyfinUserId }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(jellyfinUserId, forKey: .jellyfinUserId)
    }
}

nonisolated struct ImportJellyfinUsersBody: Encodable, Sendable {
    struct Entry: Encodable, Sendable {
        let jellyfinUserId: String
        let isAdmin: Bool
    }

    let users: [Entry]
}

nonisolated struct ImportJellyfinUsersResponse: Decodable, Sendable {
    struct Skipped: Decodable, Sendable {
        let jellyfinUserId: String
        let reason: String
    }

    struct Created: Decodable, Sendable {
        let jellyfinUserId: String
        let userId: String
    }

    let created: [Created]
    let skipped: [Skipped]
}

// MARK: Users admin + invitations (spec §5 Phase 5)

nonisolated struct SetRoleBody: Encodable, Sendable { let isAdmin: Bool }
nonisolated struct ResetPasswordBody: Encodable, Sendable { let password: String }
nonisolated struct CreateUserBody: Encodable, Sendable {
    let email: String
    let password: String
    let firstName: String?
    let lastName: String?
    let locale: String
    let isAdmin: Bool
}

nonisolated struct CreateInvitationBody: Encodable, Sendable {
    let email: String
    let locale: String
    let isAdmin: Bool
}

nonisolated struct TokenResponse: Decodable, Sendable { let token: String? }
nonisolated struct InvitationDTO: Decodable, Identifiable, Sendable {
    let id: Int
    let email: String
    let status: String
    let isAdmin: Bool?
    let createdAt: String?
    let expiresAt: String?
}

nonisolated struct InvitationsResponse: Decodable, Sendable { let invitations: [InvitationDTO] }

// MARK: Sessions + web-push + API keys + blocklist (spec §5 Phase 5)

nonisolated struct SessionDeviceDTO: Decodable, Sendable { let browser: String?; let os: String? }
nonisolated struct AdminSessionDTO: Decodable, Identifiable, Sendable {
    let id: String
    let userId: String?
    let userEmail: String?
    let userName: String?
    let expiresAt: String?
    let createdAt: String?
    let ipAddress: String?
    let device: SessionDeviceDTO?
}

nonisolated struct AdminSessionsResponse: Decodable, Sendable { let sessions: [AdminSessionDTO] }

nonisolated struct AdminWebPushDTO: Decodable, Identifiable, Sendable {
    let id: Int
    let userEmail: String?
    let userName: String?
    let endpoint: String?
    let deviceName: String?
    let createdAt: String?
}

nonisolated struct AdminWebPushResponse: Decodable, Sendable { let subscriptions: [AdminWebPushDTO] }

nonisolated struct ApiKeyDTO: Decodable, Identifiable, Sendable {
    let id: String
    let name: String?
    let start: String?
    let lastUsed: String?
    let expiresAt: String?
    let createdAt: String?
}

nonisolated struct ApiKeysResponse: Decodable, Sendable { let apiKeys: [ApiKeyDTO] }
nonisolated struct CreateApiKeyBody: Encodable, Sendable {
    let name: String
    let expiresInDays: Int?
}

nonisolated struct CreateApiKeyResponse: Decodable, Sendable { let key: String? }

nonisolated struct BlocklistEntryDTO: Decodable, Identifiable, Sendable {
    let id: Int
    let releaseTitle: String?
    let indexer: String?
    let reason: String?
    let blockedAt: String?
}

nonisolated struct BlocklistResponse: Decodable, Sendable { let entries: [BlocklistEntryDTO] }

// MARK: SSO / OIDC providers CRUD (spec §5 Phase 5)

nonisolated struct OidcProviderDTO: Decodable, Identifiable, Sendable {
    let id: String
    let slug: String
    let name: String
    let discoveryUrl: String?
    let clientId: String?
    let clientSecretSet: Bool?
    let enabled: Bool
    let iconUrl: String?
}

nonisolated struct OidcProvidersResponse: Decodable, Sendable { let providers: [OidcProviderDTO] }

// MARK: Releases + jobs (spec §5 Phase 5 + Appendix B)

nonisolated struct GithubReleaseDTO: Decodable, Identifiable, Sendable {
    let tagName: String
    let name: String?
    let publishedAt: String?
    var id: String {
        tagName
    }
}

nonisolated struct ReleaseSyncDTO: Decodable, Sendable {
    let repoFullName: String?
    let lastSyncedAt: String?
    let lastError: String?
}

nonisolated struct ReleasesResponse: Decodable, Sendable {
    let releases: [GithubReleaseDTO]
    let sync: ReleaseSyncDTO?
}

nonisolated struct TriggerActionBody: Encodable, Sendable { let action: String }

// MARK: Profile (spec §5 Phase 5)

nonisolated struct UpdateProfileBody: Encodable, Sendable {
    let firstName: String?
    let lastName: String?
}

/// The per-user iCal feed of library release dates.
nonisolated struct CalendarSubscription: Decodable, Sendable {
    let url: String
    let webcalUrl: String
}

nonisolated struct ChangePasswordBody: Encodable, Sendable {
    let currentPassword: String
    let newPassword: String
}

nonisolated struct CreateOidcBody: Encodable, Sendable {
    let slug: String
    let name: String
    let discoveryUrl: String
    let clientId: String
    let clientSecret: String
    let enabled: Bool
    let iconUrl: String?
}

nonisolated struct UpdateOidcBody: Encodable, Sendable {
    let name: String
    let discoveryUrl: String
    let clientId: String
    let clientSecret: String?
    let enabled: Bool
    let iconUrl: String?
}

nonisolated struct AdminUsersResponse: Decodable, Sendable {
    let success: Bool?
    let users: [AdminUser]
}

nonisolated struct SystemVersion: Decodable, Sendable {
    let version: String
}

nonisolated struct SessionUser: Decodable, Sendable {
    let id: String?
    let email: String?
    let name: String?
    let firstName: String?
    let lastName: String?
    let isAdmin: Bool?
    let notificationPreferences: [String: Bool]?
    let avatarUrl: String?
}

nonisolated struct SessionResponse: Decodable, Sendable {
    let user: SessionUser?
}
