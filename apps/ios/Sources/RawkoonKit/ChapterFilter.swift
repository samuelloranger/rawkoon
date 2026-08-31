import Foundation

/// Narrows an in-memory chapter list by title and 1-based index.
///
/// Title matching is case- and diacritic-insensitive (`localizedStandardContains`)
/// so a French library query like "menage" hits "ménage". Index matching
/// compares against the on-screen 1-based number and accepts a substring, so
/// "4" yields 4, 14, 40–49. An empty or whitespace query returns `chapters`
/// unchanged, in order, with no duplicates.
public func filterChapters(_ chapters: [ManifestChapter], query: String) -> [ManifestChapter] {
    let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !needle.isEmpty else { return chapters }
    return chapters.filter { chapter in
        chapter.title.localizedStandardContains(needle)
            || String(chapter.index + 1).contains(needle)
    }
}
