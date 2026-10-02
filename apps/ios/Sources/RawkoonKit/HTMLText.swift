import Foundation

/// Plain text from the small HTML fragments metadata providers put in descriptions.
/// Pure string work: the NSAttributedString HTML importer spins the main run loop
/// through WebKit, which re-enters SwiftUI mid-render and hangs the app.
public enum HTMLText {
    public static func plainText(_ html: String) -> String {
        let trimmed = html.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.contains("<") || trimmed.contains("&") else { return trimmed }

        let stripped = trimmed
            .replacing(#/<(script|style)\b[^>]*>.*?</\1\s*>/#.ignoresCase().dotMatchesNewlines(), with: "")
            .replacing(#/<!--.*?-->/#.dotMatchesNewlines(), with: "")
            .replacing(#/\s*<br\s*/?>\s*/#.ignoresCase(), with: "\n")
            .replacing(#/\s*<li\b[^>]*>\s*/#.ignoresCase(), with: "\n• ")
            .replacing(#/\s*</?(p|div|h[1-6]|ul|ol|blockquote)\b[^>]*>\s*/#.ignoresCase(), with: "\n\n")
            .replacing(#/<[^>]*>/#, with: "")

        let decoded = decodeEntities(stripped)
            .replacingOccurrences(of: "\u{00A0}", with: " ")
            .replacing(#/[ \t]+/#, with: " ")
            .replacing(#/ *\n */#, with: "\n")
            .replacing(#/\n{3,}/#, with: "\n\n")
        return decoded.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func decodeEntities(_ text: String) -> String {
        guard text.contains("&") else { return text }
        return text.replacing(#/&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z]{2,8});/#) { match in
            let name = match.output.1
            if name.hasPrefix("#x") || name.hasPrefix("#X") {
                return scalar(UInt32(name.dropFirst(2), radix: 16)) ?? String(match.output.0)
            }
            if name.hasPrefix("#") {
                return scalar(UInt32(name.dropFirst())) ?? String(match.output.0)
            }
            return namedEntities[String(name)] ?? String(match.output.0)
        }
    }

    private static func scalar(_ value: UInt32?) -> String? {
        guard let value, let scalar = Unicode.Scalar(value) else { return nil }
        return String(Character(scalar))
    }

    private static let namedEntities: [String: String] = [
        "amp": "&", "lt": "<", "gt": ">", "quot": "\"", "apos": "'", "nbsp": "\u{00A0}",
        "hellip": "…", "mdash": "—", "ndash": "–", "lsquo": "‘", "rsquo": "’",
        "ldquo": "“", "rdquo": "”", "laquo": "«", "raquo": "»", "bull": "•", "middot": "·",
        "copy": "©", "reg": "®", "trade": "™", "deg": "°",
        "agrave": "à", "acirc": "â", "auml": "ä", "ccedil": "ç", "eacute": "é", "egrave": "è",
        "ecirc": "ê", "euml": "ë", "icirc": "î", "iuml": "ï", "ocirc": "ô", "ouml": "ö",
        "ugrave": "ù", "ucirc": "û", "uuml": "ü", "oelig": "œ", "aelig": "æ",
        "Agrave": "À", "Acirc": "Â", "Ccedil": "Ç", "Eacute": "É", "Egrave": "È", "Ecirc": "Ê",
        "Icirc": "Î", "Ocirc": "Ô", "Ugrave": "Ù", "Ucirc": "Û", "OElig": "Œ",
    ]
}
