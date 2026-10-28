import RawkoonKit
import SwiftUI

/// What one inbox row says: the title and its code on line one, a coloured
/// status word and a detail on line two. Built from the structured metadata,
/// else read from an older notice's body, else its own title and body.
struct NotificationLines {
    let title: String
    let code: String?
    let status: String?
    let statusTint: Color
    let detail: String?

    init(_ notification: NotificationDTO) {
        let meta = notification.metadata
        let status = Self.status(type: notification.type, isUpgrade: meta?.isUpgrade == true)

        if let status, let subject = Self.subject(notification) {
            title = subject.title
            self.status = status.label
            statusTint = status.tint
            if let count = meta?.groupCount, count > 1 {
                code = nil
                detail = subject.code.map { String(localized: "\(count) episodes, latest \($0)") }
                    ?? String(localized: "\(count) episodes")
            } else {
                code = subject.code
                detail = Self.detail(subject.detail, type: notification.type, episodeCount: meta?.episodeCount)
            }
            return
        }

        if let version = Self.versionTitle(notification) {
            title = version
            code = nil
            self.status = notification.type == "app-update"
                ? String(localized: "Installed")
                : String(localized: "New version")
            statusTint = Theme.apricotSoft
            detail = Self.releaseHighlights(notification.body)
            return
        }

        title = notification.title
        code = nil
        self.status = nil
        statusTint = Theme.muted
        detail = notification.body
    }

    private static func subject(_ notification: NotificationDTO) -> NotificationLedger.Subject? {
        let meta = notification.metadata
        let legacy = NotificationLedger.legacySubject(title: notification.title, body: notification.body)
        if let subject = meta?.subject ?? meta?.show.map(NotificationLedger.strippingYear) {
            // Older notices name the show in metadata but leave the episode name in the body.
            return .init(
                title: subject, code: meta?.code ?? meta?.latestCode ?? legacy?.code,
                detail: meta?.detail ?? legacy?.detail
            )
        }
        return legacy
    }

    private static func detail(_ raw: String?, type: String, episodeCount: Int?) -> String? {
        if let episodeCount, episodeCount > 1 {
            return String(localized: "\(episodeCount) episodes")
        }
        guard let raw else { return nil }
        if type.hasSuffix("_grabbed") {
            return NotificationLedger.releaseSummary(raw) ?? raw
        }
        return raw
    }

    private static func status(type: String, isUpgrade: Bool) -> (label: String, tint: Color)? {
        switch type {
        case "library_media_downloaded", "book_downloaded":
            (isUpgrade ? String(localized: "Upgraded") : String(localized: "Downloaded"), Theme.seed)
        case "library_media_grabbed", "book_grabbed":
            (String(localized: "Grabbed"), Theme.importing)
        case "library_download_failed", "library_post_process_failed", "book_import_failed":
            (String(localized: "Failed"), Theme.terracotta)
        case "request_pending":
            (String(localized: "Awaiting approval"), Theme.apricot)
        case "request_available":
            (String(localized: "Available"), Theme.seed)
        default:
            nil
        }
    }

    /// "Rawkoon v1.46.0" for a single-release or update notice.
    private static func versionTitle(_ notification: NotificationDTO) -> String? {
        let meta = notification.metadata
        let version: String? = switch notification.type {
        case "app-update": meta?.version
        case "github-release": meta?.releases?.count == 1 ? meta?.releases?.first?.tagName : nil
        default: nil
        }
        guard let version else { return nil }
        return "Rawkoon \(version.hasPrefix("v") ? version : "v\(version)")"
    }

    /// The release body opens with "v1.46.0 — "; the row already names the version.
    private static func releaseHighlights(_ body: String) -> String? {
        guard let dash = body.range(of: " — ") else { return nil }
        let highlights = body[dash.upperBound...].trimmingCharacters(in: .whitespaces)
        return highlights.isEmpty ? nil : highlights
    }
}

/// One inbox row: leading poster or icon, two lines, and the time with the
/// unread dot. The row's action button, when it has one, sits beside it.
struct NotificationLedgerRow: View {
    let notification: NotificationDTO
    let time: String?

    var body: some View {
        let lines = NotificationLines(notification)
        HStack(spacing: 12) {
            NotificationLeadingVisual(
                type: notification.type, metadata: notification.metadata,
                imageUrl: notification.imageUrl, gutter: 32
            )
            VStack(alignment: .leading, spacing: 2) {
                firstLine(lines)
                    .font(.subheadline)
                    .lineLimit(1)
                secondLine(lines)
                    .font(.footnote)
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .trailing, spacing: 6) {
                if let time {
                    Text(time)
                        .font(.caption)
                        .monospacedDigit()
                        .foregroundStyle(Theme.faint)
                }
                // Always laid out so the row never shifts when it is read; only its opacity changes.
                Circle().fill(Theme.apricot).frame(width: 8, height: 8)
                    .opacity(notification.read ? 0 : 1)
                    .rawkoonMotion(RawkoonMotion.snappy, value: notification.read)
            }
        }
        .frame(minHeight: 48)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private func firstLine(_ lines: NotificationLines) -> Text {
        let title = Text(lines.title)
            .fontWeight(notification.read ? .medium : .semibold)
            .foregroundStyle(Theme.textStrong)
        guard let code = lines.code else { return title }
        return title + Text(verbatim: "  \(code)").foregroundStyle(Theme.muted)
    }

    private func secondLine(_ lines: NotificationLines) -> Text {
        let detail = lines.detail.map { Text(verbatim: $0) }
        guard let status = lines.status else { return detail ?? Text(verbatim: "") }
        let label = Text(status).fontWeight(.semibold).foregroundStyle(lines.statusTint)
        guard let detail else { return label }
        return label + Text(verbatim: " · ") + detail
    }
}

/// A day section's heading: "Today", "Yesterday", a weekday or a date, with
/// the date on the right when the heading is a word.
struct NotificationDayHeader: View {
    let day: NotificationLedger.Day

    var body: some View {
        let (title, date) = Self.labels(day)
        HStack(alignment: .firstTextBaseline) {
            Text(verbatim: title)
                .font(.display(15))
                .foregroundStyle(Theme.textStrong)
            Spacer()
            if let date {
                Text(verbatim: date)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(Theme.faint)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 14)
        .padding(.bottom, 4)
        .frame(maxWidth: .infinity)
        .background(Theme.raised)
        .listRowInsets(EdgeInsets())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    private static func labels(_ day: NotificationLedger.Day) -> (String, String?) {
        let dayMonth = Date.FormatStyle.dateTime.day().month(.abbreviated)
        switch day {
        case .today:
            return (String(localized: "Today"), nil)
        case .yesterday:
            let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: Date()) ?? Date()
            return (String(localized: "Yesterday"), yesterday.formatted(dayMonth))
        case let .thisWeek(date):
            let weekday = date.formatted(.dateTime.weekday(.wide))
            return (weekday.prefix(1).uppercased() + weekday.dropFirst(), date.formatted(dayMonth))
        case let .older(date):
            let sameYear = Calendar.current.isDate(date, equalTo: Date(), toGranularity: .year)
            let style = sameYear
                ? Date.FormatStyle.dateTime.day().month(.wide)
                : Date.FormatStyle.dateTime.day().month(.wide).year()
            return (date.formatted(style), nil)
        }
    }
}
