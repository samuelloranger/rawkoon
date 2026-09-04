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

/// Maps the app's only surfaced error to a fixed local string for a settings
/// screen. Admin screens say "Admin only" on 401/403; account screens say
/// "Unauthorized".
func settingsErrorMessage(_ error: Error, admin: Bool = true) -> String {
    guard let apiError = error as? APIError else { return String(localized: "Something went wrong.") }
    switch apiError {
    case .unauthorized:
        return admin ? String(localized: "Admin only.") : String(localized: "Unauthorized. Check your credentials.")
    case .transport:
        return String(localized: "Network error. Check your connection.")
    case .http:
        return String(localized: "Couldn't save. Check the values and try again.")
    case .decode:
        return String(localized: "Unexpected response from the server.")
    }
}
