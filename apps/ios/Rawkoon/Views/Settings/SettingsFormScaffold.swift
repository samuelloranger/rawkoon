import SwiftUI

/// Loading / error / content wrapper used by every settings screen. The error
/// string is a fixed local message mapped from `APIError` by status — the server
/// hides error detail, so never display a raw server message (spec §4.8).
struct SettingsStateView<Content: View>: View {
    let isLoading: Bool
    let error: String?
    let retry: () -> Void
    @ViewBuilder var content: () -> Content

    var body: some View {
        if isLoading {
            HStack {
                Spacer()
                ProgressView().tint(Theme.apricot)
                Spacer()
            }
            .listRowBackground(Theme.raised)
        } else if let error {
            VStack(alignment: .leading, spacing: 8) {
                Text(error).foregroundStyle(Theme.terracotta)
                Button("Retry", action: retry).tint(Theme.apricot)
            }
            .listRowBackground(Theme.raised)
        } else {
            content()
        }
    }
}

/// Maps a settings-screen error to a local string. Permission denials (403)
/// stay generic ("Admin only"); a server `{error}` body is shown as-is so a
/// 503 is not reduced to "Server error (503)".
func settingsErrorMessage(_ error: Error, admin: Bool = true) -> String {
    guard let apiError = error as? APIError else { return String(localized: "Something went wrong.") }
    switch apiError {
    case .unauthorized:
        return String(localized: "Unauthorized. Check your credentials.")
    case .forbidden:
        return admin ? String(localized: "Admin only.") : String(localized: "You don't have permission to do that.")
    case .transport:
        return String(localized: "Network error. Check your connection.")
    case .http:
        return String(localized: "Couldn't save. Check the values and try again.")
    case let .server(_, message):
        return message
    case .decode:
        return String(localized: "Unexpected response from the server.")
    }
}
