import Foundation

/// Up to two initials for the tab-bar avatar, or nil when no name is usable.
public enum UserInitials {
    public static func from(firstName: String?, lastName: String?, name: String?) -> String? {
        let named = [firstName, lastName]
            .compactMap { $0?.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        let words = named.isEmpty
            ? (name ?? "").split(separator: " ").map(String.init)
            : named
        let letters = words.prefix(2).compactMap(\.first).map { String($0).uppercased() }
        return letters.isEmpty ? nil : letters.joined()
    }
}
