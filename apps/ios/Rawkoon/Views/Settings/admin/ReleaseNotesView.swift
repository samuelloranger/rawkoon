import RawkoonKit
import SwiftUI

/// One release in the Releases list: its name, tag and date, and the opening
/// line of its notes so the list says what changed without opening each one.
struct ReleaseSummaryRow: View {
    let release: GithubReleaseDTO

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Text(ReleaseNotesView.title(release))
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Theme.textStrong)
                    .lineLimit(2)
                if release.prerelease == true {
                    PreReleaseBadge()
                }
            }
            Text(verbatim: ReleaseNotesView.meta(release))
                .font(.footnote)
                .foregroundStyle(Theme.muted)
            if let summary = release.body.flatMap(ReleaseNotes.summary) {
                // No links here: the whole row is the tap target.
                ReleaseNotesView.inline(summary, repo: nil)
                    .font(.footnote)
                    .foregroundStyle(Theme.text)
                    .lineLimit(2)
                    .padding(.top, 2)
            }
        }
        .padding(.vertical, 4)
    }
}

/// A release's full notes, rendered from its markdown body (web: `ReleasesTab`).
struct ReleaseNotesView: View {
    let release: GithubReleaseDTO
    let repo: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                header
                let blocks = ReleaseNotes.blocks(release.body ?? "")
                if blocks.isEmpty {
                    Text("No release notes.")
                        .foregroundStyle(Theme.muted)
                } else {
                    ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                        view(for: block)
                    }
                }
                assets
            }
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
        }
        .readableWidth()
        .background(Theme.base)
        .tint(Theme.apricot)
        .navigationTitle(release.tagName)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let url = release.htmlUrl.flatMap(URL.init(string:)) {
                ToolbarItem(placement: .topBarTrailing) {
                    Link(destination: url) {
                        Label("Open on GitHub", systemImage: "safari")
                    }
                }
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(Self.title(release))
                .font(.display(26))
                .foregroundStyle(Theme.textStrong)
                .accessibilityAddTraits(.isHeader)
            HStack(spacing: 8) {
                Text(verbatim: Self.meta(release, withAuthor: true))
                    .font(.footnote)
                    .foregroundStyle(Theme.muted)
                if release.prerelease == true {
                    PreReleaseBadge()
                }
            }
        }
        .padding(.bottom, 8)
    }

    @ViewBuilder
    private var assets: some View {
        if let assets = release.assets, !assets.isEmpty {
            Text("Files")
                .font(.sectionTitle)
                .foregroundStyle(Theme.textStrong)
                .padding(.top, 12)
                .accessibilityAddTraits(.isHeader)
            ForEach(assets) { asset in
                if let url = URL(string: asset.browserDownloadUrl) {
                    Link(destination: url) {
                        Label(asset.name, systemImage: "shippingbox")
                            .font(.subheadline)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func view(for block: ReleaseNotes.Block) -> some View {
        switch block {
        case let .heading(level, text):
            Self.inline(text, repo: repo)
                .font(level <= 2 ? .display(21) : .sectionTitle)
                .foregroundStyle(Theme.textStrong)
                .padding(.top, 10)
                .accessibilityAddTraits(.isHeader)
        case let .paragraph(text):
            Self.inline(text, repo: repo)
                .foregroundStyle(Theme.text)
        case let .bullet(depth, text):
            listItem(marker: "•", depth: depth, text: text)
        case let .numbered(depth, number, text):
            listItem(marker: "\(number).", depth: depth, text: text)
        case let .quote(text):
            HStack(alignment: .top, spacing: 10) {
                Capsule().fill(Theme.apricot.opacity(0.6)).frame(width: 3)
                Self.inline(text, repo: repo)
                    .foregroundStyle(Theme.muted)
            }
            .fixedSize(horizontal: false, vertical: true)
        case let .code(text):
            ScrollView(.horizontal) {
                Text(verbatim: text)
                    .font(.footnote.monospaced())
                    .foregroundStyle(Theme.text)
                    .padding(12)
            }
            .background(Theme.inset, in: RoundedRectangle(cornerRadius: 10))
        case .rule:
            Rectangle().fill(Theme.border).frame(height: 1).padding(.vertical, 6)
        }
    }

    private func listItem(marker: String, depth: Int, text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(verbatim: marker)
                .monospacedDigit()
                .foregroundStyle(depth == 0 ? Theme.apricot : Theme.muted)
            Self.inline(text, repo: repo)
                .foregroundStyle(Theme.text)
        }
        .padding(.leading, CGFloat(min(depth, 4)) * 18)
    }

    /// Bold, code spans and links from the markdown; plain text if it doesn't parse.
    static func inline(_ markdown: String, repo: String?) -> Text {
        let linked = ReleaseNotes.linkingReferences(markdown, repo: repo)
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        guard let attributed = try? AttributedString(markdown: linked, options: options) else {
            return Text(verbatim: markdown)
        }
        return Text(attributed)
    }

    /// The headline after the tag, or the tag when the name adds nothing.
    static func title(_ release: GithubReleaseDTO) -> String {
        ReleaseNotes.headline(name: release.name, tag: release.tagName) ?? release.tagName
    }

    /// "v1.46.0 · Oct 27, 2026", plus the author on the notes screen. The tag
    /// is left out when it is already the title.
    static func meta(_ release: GithubReleaseDTO, withAuthor: Bool = false) -> String {
        let hasHeadline = ReleaseNotes.headline(name: release.name, tag: release.tagName) != nil
        var parts = hasHeadline ? [release.tagName] : []
        if let date = release.publishedAt.flatMap { formattedDate($0) } {
            parts.append(date)
        }
        if withAuthor, let login = release.author?.login {
            parts.append(login)
        }
        return parts.joined(separator: " · ")
    }

    static func formattedDate(_ iso: String, withTime: Bool = false) -> String? {
        let date = withFraction.date(from: iso) ?? plain.date(from: iso)
        return date?.formatted(date: .abbreviated, time: withTime ? .shortened : .omitted)
    }

    private nonisolated(unsafe) static let withFraction: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private nonisolated(unsafe) static let plain = ISO8601DateFormatter()
}

private struct PreReleaseBadge: View {
    var body: some View {
        Text("Pre-release")
            .font(.caption2.weight(.semibold))
            .foregroundStyle(Theme.apricot)
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .background(Theme.apricot.opacity(0.16), in: Capsule())
    }
}
