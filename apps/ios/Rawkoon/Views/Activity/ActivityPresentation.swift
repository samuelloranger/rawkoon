import SwiftUI

/// How one activity record is shown in the History lane: an SF Symbol, a
/// humanized sentence, a relative time, and display labels + a pill tint for
/// its service and type.
///
/// Swift port of `apps/web/src/pages/activity/_component/activityPresentation.ts`,
/// narrowed to the activity types Rawkoon actually emits (media grabs, app
/// updates, scheduled/manual jobs, integrations) with a titleized fallback for
/// anything else. Tints never use apricot — that lamp is reserved for the
/// primary action (One Lamp).
struct ActivityPresentation {
    let symbol: String
    let description: String
    let time: String
    let type: String
    let typeLabel: String
    let service: String
    let serviceLabel: String
    let tint: Color

    static func make(for record: ActivityRecord) -> ActivityPresentation {
        let type = record.type ?? "task_completed"
        let service = normalizedService(record)
        let time = relativeTime(record.completedAt)

        let symbol: String
        let description: String
        let tint: Color

        switch type {
        case "app_updated":
            symbol = "sparkles"
            if let from = record.fromVersion, let to = record.toVersion,
               !from.isEmpty, !to.isEmpty
            {
                description = "Updated from \(from) to \(to)"
            } else {
                description = "App updated"
            }
            tint = Theme.seed

        case "admin_triggered_job":
            symbol = "wrench.and.screwdriver"
            description = "Ran \(record.jobName ?? "a job")"
            tint = Theme.importing

        case "cron_job_skipped":
            symbol = "forward.end"
            let job = record.jobName ?? "a job"
            let reason = record.reason ?? "no reason given"
            description = "Skipped \(job): \(reason)"
            tint = Theme.muted

        case "integration_updated":
            symbol = "powerplug"
            description = "Updated \(record.integrationType ?? "an integration") integration"
            tint = Theme.importing

        case "cron_job_ended":
            if record.success == false {
                symbol = "xmark.circle"
                description = "\(record.jobName ?? "A job") failed"
                tint = Theme.terracotta
            } else {
                symbol = "checkmark.circle"
                let job = record.jobName ?? "a job"
                if let ms = record.durationMs {
                    let seconds = max(0, Int((Double(ms) / 1000).rounded()))
                    description = "\(job) finished in \(seconds)s"
                } else {
                    description = "\(job) finished"
                }
                tint = Theme.seed
            }

        case "media_grab":
            symbol = "arrow.down.circle"
            let title = record.releaseTitle ?? "a release"
            if record.grabSource == "rss", record.aiPicked == true {
                description = "AI grabbed \(title) from RSS"
            } else {
                description = "Grabbed \(title)"
            }
            tint = Theme.importing

        default:
            symbol = "checkmark.circle"
            description = record.message ?? record.releaseTitle ?? titleize(type)
            tint = Theme.muted
        }

        return ActivityPresentation(
            symbol: symbol,
            description: description,
            time: time,
            type: type,
            typeLabel: typeLabel(for: type),
            service: service,
            serviceLabel: serviceLabel(for: service),
            tint: tint
        )
    }

    // MARK: Labels (also used by the History filter chips)

    static func typeLabel(for type: String) -> String {
        switch type {
        case "media_grab": "Media Grab"
        case "app_updated": "App Updated"
        case "cron_job_ended": "Scheduled Job"
        case "cron_job_skipped": "Job Skipped"
        case "integration_updated": "Integration"
        case "admin_triggered_job": "Manual Job"
        default: titleize(type)
        }
    }

    static func serviceLabel(for service: String) -> String {
        switch service.trimmingCharacters(in: .whitespaces).lowercased() {
        case "tmdb": "TMDB"
        case "jellyfin": "Jellyfin"
        case "qbittorrent": "qBittorrent"
        case "prowlarr": "Prowlarr"
        case "library": "Library"
        case "system": "System"
        case "admin": "Admin"
        default: titleize(service)
        }
    }

    // MARK: Helpers

    private static func normalizedService(_ record: ActivityRecord) -> String {
        if let raw = record.service?.trimmingCharacters(in: .whitespaces), !raw.isEmpty {
            return raw.lowercased()
        }
        return "system"
    }

    private static func titleize(_ value: String) -> String {
        value
            .split(whereSeparator: { $0 == "_" || $0 == "-" })
            .map { $0.prefix(1).uppercased() + $0.dropFirst() }
            .joined(separator: " ")
    }

    /// Parses the server's ISO-8601 timestamp (with or without fractional
    /// seconds) into an abbreviated relative string; empty when absent/unparsed.
    static func relativeTime(_ isoString: String?) -> String {
        guard let isoString else { return "" }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        guard let date = withFraction.date(from: isoString) ?? plain.date(from: isoString) else {
            return ""
        }
        let relative = RelativeDateTimeFormatter()
        relative.unitsStyle = .abbreviated
        return relative.localizedString(for: date, relativeTo: Date())
    }
}
