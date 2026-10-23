import Foundation

/// How a failed `POST /api/auth/sign-in/jellyfin` reads to the user. The server
/// does not promise a message body, so the status code alone picks the copy.
public enum JellyfinSignInFailure: Equatable, Sendable {
    /// 401: Jellyfin rejected the username or password.
    case wrongCredentials
    /// 403: the Jellyfin account may not sign in to Rawkoon.
    case noAccess
    /// 502: the server could not reach Jellyfin.
    case jellyfinUnreachable
    /// 404: Jellyfin sign-in is off or Jellyfin is not configured.
    case notEnabled
    /// 429: too many attempts for this username.
    case tooManyAttempts
    case other

    public init(status: Int) {
        switch status {
        case 401: self = .wrongCredentials
        case 403: self = .noAccess
        case 502: self = .jellyfinUnreachable
        case 404: self = .notEnabled
        case 429: self = .tooManyAttempts
        default: self = .other
        }
    }

    public init(failure: HTTPFailure) {
        switch failure {
        case .unauthorized: self = .wrongCredentials
        case .forbidden: self = .noAccess
        case let .server(status, _), let .http(status): self.init(status: status)
        }
    }
}
