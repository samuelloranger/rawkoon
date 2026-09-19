import Foundation
import RawkoonKit

// System / management-hub read queries (quality profiles, indexers, download
// client, admin users, version, features). Split out of APIClient.swift to
// stay under the file_length lint threshold (spec §4.2). Mutating settings
// methods live in APIClient+Settings.swift.

extension APIClient {
    func qualityProfiles() async throws -> QualityProfilesResponse {
        try await get("/api/quality-profiles")
    }

    func indexers() async throws -> IndexersResponse {
        try await get("/api/medias/indexers")
    }

    func downloadClient() async throws -> DownloadClientResponse {
        try await get("/api/integrations/download-client")
    }

    func adminUsers() async throws -> AdminUsersResponse {
        try await get("/api/admin/users")
    }

    func systemVersion() async throws -> SystemVersion {
        try await get("/api/system/version")
    }

    func systemFeatures() async throws -> SystemFeatures {
        try await get("/api/system/features")
    }
}
