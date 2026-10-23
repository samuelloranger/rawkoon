import Foundation

/// How the admin Users screens name and describe an account.
public enum AdminUserDisplay {
    /// Accounts created from Jellyfin get this address because better-auth needs a unique email.
    public static func isPlaceholderEmail(_ email: String) -> Bool {
        email.lowercased().hasSuffix("@jellyfin.invalid")
    }

    /// First and last name when set; else the email, unless it's a Jellyfin placeholder.
    public static func name(firstName: String?, lastName: String?, email: String) -> String? {
        let full = [firstName, lastName]
            .compactMap { $0?.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        if !full.isEmpty {
            return full
        }
        return isPlaceholderEmail(email) ? nil : email
    }

    /// Case- and accent-insensitive match on name or email, for the search field.
    public static func matches(_ query: String, firstName: String?, lastName: String?, email: String) -> Bool {
        let needle = query.trimmingCharacters(in: .whitespaces)
        guard !needle.isEmpty else { return true }
        let haystack = [firstName, lastName, email].compactMap(\.self).joined(separator: " ")
        return haystack.range(of: needle, options: [.caseInsensitive, .diacriticInsensitive]) != nil
    }

    /// The list only grows a search field once scanning by eye stops being quick.
    public static let searchThreshold = 8
}
