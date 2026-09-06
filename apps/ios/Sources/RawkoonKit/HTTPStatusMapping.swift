import Foundation

/// A non-2xx HTTP outcome, optionally carrying the server's `{error}` message.
public enum HTTPFailure: Equatable, Sendable {
    case unauthorized
    case forbidden
    case server(status: Int, message: String)
    case http(Int)
}

/// Pure mapping from status code + body bytes onto `HTTPFailure`.
///
/// 401 and 403 stay distinct so the app can log out on expiry without treating
/// a permission denial as a dead session. Any other status that ships a JSON
/// `{error: string}` body surfaces that string; otherwise the status alone is kept.
public enum HTTPStatusMapping {
    private struct ServerErrorBody: Decodable {
        let error: String
    }

    public static func failure(status: Int, body: Data) -> HTTPFailure {
        switch status {
        case 401: .unauthorized
        case 403: .forbidden
        default:
            if let message = errorMessage(from: body) {
                .server(status: status, message: message)
            } else {
                .http(status)
            }
        }
    }

    public static func errorMessage(from body: Data) -> String? {
        guard let parsed = try? JSONDecoder().decode(ServerErrorBody.self, from: body) else {
            return nil
        }
        let trimmed = parsed.error.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
