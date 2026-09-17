import Foundation
import SwiftUI

/// The app's UI-language override. iOS has no per-app language screen of its own,
/// so this is Rawkoon's in-app switch: `.system` follows the device/app locale,
/// `.en`/`.fr` force a language. It is the single source of truth read both by
/// the SwiftUI root (as an environment locale) and by `APIClient` (to send the
/// server the locale it should localize titles and TMDB metadata in).
enum AppLanguage: String, CaseIterable, Identifiable {
    case system
    case en
    case fr

    /// UserDefaults / `@AppStorage` key. Stored as the raw value ("system"/"en"/"fr").
    nonisolated static let storageKey = "app_language"

    var id: String {
        rawValue
    }

    /// Short label for the settings picker. Kept as plain strings (endonyms) so a
    /// French speaker sees "Français" whatever the current UI language is.
    var label: LocalizedStringKey {
        switch self {
        case .system: "System"
        case .en: "English"
        case .fr: "Français"
        }
    }

    /// The stored override, defaulting to `.system` for an unset/unknown value.
    nonisolated static var stored: AppLanguage {
        AppLanguage(rawValue: UserDefaults.standard.string(forKey: storageKey) ?? "") ?? .system
    }

    /// Base language code ("en"/"fr") the server stores titles for, honoring the
    /// override and otherwise following the app's preferred localization. Anything
    /// that is not French collapses to English — the server's default.
    nonisolated static var resolvedTitleCode: String {
        switch stored {
        case .en: return "en"
        case .fr: return "fr"
        case .system:
            let preferred = Bundle.main.preferredLocalizations.first ?? "en"
            let base =
                preferred
                    .split(whereSeparator: { $0 == "-" || $0 == "_" })
                    .first
                    .map(String.init) ?? preferred
            return base.lowercased() == "fr" ? "fr" : "en"
        }
    }

    /// TMDB `language` param (e.g. "fr-FR") for the resolved locale.
    nonisolated static var resolvedTmdbLanguage: String {
        resolvedTitleCode == "fr" ? "fr-FR" : "en-US"
    }

    /// SwiftUI environment locale for the current override. `.system` returns the
    /// autoupdating current locale (i.e. no override).
    nonisolated static func locale(for value: AppLanguage) -> Locale {
        switch value {
        case .system: Locale.autoupdatingCurrent
        case .en: Locale(identifier: "en")
        case .fr: Locale(identifier: "fr")
        }
    }
}
