import Foundation

/// Splits a GitHub release body into the blocks the app lays out: headings,
/// paragraphs, nested lists, quotes and code. Inline styling (bold, code spans,
/// links) stays in each block's text for `AttributedString(markdown:)`, which
/// only understands inline syntax. Pure so it is unit-tested on Linux.
public enum ReleaseNotes {
    public enum Block: Equatable, Sendable {
        case heading(level: Int, text: String)
        case paragraph(String)
        case bullet(depth: Int, text: String)
        case numbered(depth: Int, number: Int, text: String)
        case quote(String)
        case code(String)
        case rule
    }

    public static func blocks(_ markdown: String) -> [Block] {
        var parser = Parser()
        for line in markdown.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n") {
            parser.consume(line)
        }
        return parser.finish()
    }

    /// "v1.46.0 — Epub chapter names" → "Epub chapter names". Nil when the
    /// name only repeats the tag, so the caller shows the tag alone.
    public static func headline(name: String?, tag: String) -> String? {
        guard let name = name?.trimmingCharacters(in: .whitespaces), !name.isEmpty, name != tag else { return nil }
        for separator in [" — ", " – ", " - ", ": "] where name.hasPrefix(tag + separator) {
            let rest = name.dropFirst(tag.count + separator.count).trimmingCharacters(in: .whitespaces)
            return rest.isEmpty ? nil : rest
        }
        return name
    }

    /// The body's opening paragraph, for a one-glance preview.
    public static func summary(_ markdown: String) -> String? {
        for block in blocks(markdown) {
            if case let .paragraph(text) = block {
                return text
            }
        }
        return nil
    }

    /// Turns "(#387)" into a link to the repo's issue page, which GitHub
    /// redirects to the pull request. Code spans and existing links are left alone.
    public static func linkingReferences(_ text: String, repo: String?) -> String {
        guard let repo, !repo.isEmpty else { return text }
        return text.components(separatedBy: "`").enumerated().map { index, segment in
            guard index.isMultiple(of: 2) else { return segment }
            return segment.replacing(/(^|[\s(,;])#(\d+)\b/) { match in
                "\(match.1)[#\(match.2)](https://github.com/\(repo)/issues/\(match.2))"
            }
        }.joined(separator: "`")
    }

    private struct Parser {
        var blocks: [Block] = []
        var paragraph: [String] = []
        var quote: [String] = []
        var code: [String]?
        /// The open list item, so an indented line under it continues its text.
        var item: (block: Block, indent: Int)?

        mutating func consume(_ line: String) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if consumeCode(line, trimmed: trimmed) || trimmed.hasPrefix("<!--") {
                return
            }
            if trimmed.isEmpty {
                flush()
                return
            }

            let indent = line.prefix { $0 == " " || $0 == "\t" }
                .reduce(0) { $0 + ($1 == "\t" ? 4 : 1) }

            if let match = trimmed.wholeMatch(of: /(#{1,6})\s+(.+?)\s*#*/) {
                flush()
                blocks.append(.heading(level: match.1.count, text: String(match.2)))
            } else if trimmed.wholeMatch(of: /(-\s*){3,}|(\*\s*){3,}|(_\s*){3,}/) != nil {
                flush()
                blocks.append(.rule)
            } else if let match = trimmed.wholeMatch(of: /[-*+]\s+(.*)/) {
                openItem(.bullet(depth: indent / 2, text: String(match.1)), indent: indent)
            } else if let match = trimmed.wholeMatch(of: /(\d+)[.)]\s+(.*)/) {
                let number = Int(match.1) ?? 1
                openItem(.numbered(depth: indent / 2, number: number, text: String(match.2)), indent: indent)
            } else if let match = trimmed.wholeMatch(of: />\s?(.*)/) {
                flushParagraph()
                flushItem()
                quote.append(String(match.1))
            } else if let open = item, indent > open.indent || paragraph.isEmpty {
                // A wrapped line of the open list item.
                item = (open.block.appending(trimmed), open.indent)
            } else {
                flushItem()
                flushQuote()
                paragraph.append(trimmed)
            }
        }

        /// Handles fence lines and everything inside a fence; true when the line was used.
        private mutating func consumeCode(_ line: String, trimmed: String) -> Bool {
            let isFence = trimmed.hasPrefix("```")
            guard var lines = code else {
                if isFence {
                    flush()
                    code = []
                }
                return isFence
            }
            if isFence {
                blocks.append(.code(lines.joined(separator: "\n")))
                code = nil
            } else {
                lines.append(line)
                code = lines
            }
            return true
        }

        mutating func finish() -> [Block] {
            if let lines = code {
                blocks.append(.code(lines.joined(separator: "\n")))
                code = nil
            }
            flush()
            return blocks
        }

        private mutating func openItem(_ block: Block, indent: Int) {
            flushParagraph()
            flushQuote()
            flushItem()
            item = (block, indent)
        }

        private mutating func flush() {
            flushParagraph()
            flushQuote()
            flushItem()
        }

        private mutating func flushParagraph() {
            guard !paragraph.isEmpty else { return }
            blocks.append(.paragraph(paragraph.joined(separator: " ")))
            paragraph = []
        }

        private mutating func flushQuote() {
            guard !quote.isEmpty else { return }
            blocks.append(.quote(quote.joined(separator: " ")))
            quote = []
        }

        private mutating func flushItem() {
            guard let open = item else { return }
            blocks.append(open.block)
            item = nil
        }
    }
}

private extension ReleaseNotes.Block {
    func appending(_ more: String) -> Self {
        switch self {
        case let .bullet(depth, text): .bullet(depth: depth, text: "\(text) \(more)")
        case let .numbered(depth, number, text): .numbered(depth: depth, number: number, text: "\(text) \(more)")
        default: self
        }
    }
}
