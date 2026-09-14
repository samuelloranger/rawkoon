import SwiftUI

/// Release sources a quality profile can rank.
///
/// The value is the parser's spelling and is what gets stored and scored; only
/// the label is display text. "Blu-ray" is the trademarked name, "BluRay" is how
/// release titles spell it. One table so the editor and the debug harness can't
/// drift apart.
enum QualityProfileSources {
    static let options: [(value: String, label: LocalizedStringKey)] = [
        ("REMUX", "REMUX"),
        ("BluRay", "Blu-ray"),
        ("WEB-DL", "WEB-DL"),
        ("WEBRip", "WEBRip"),
        ("HDTV", "HDTV"),
    ]
}
