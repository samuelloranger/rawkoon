import Foundation

/// The app's shared, tested number/duration formatters. Each function preserves
/// exactly one pre-existing rendering — the copies they replace disagreed in
/// ways that reach the common case (padded vs unpadded minutes, rounding vs
/// truncation, echo vs nil on bad input), so they are kept distinct on purpose.
public enum Formatters {
    /// MediaDetailView rendering: truncating, unpadded, nil on invalid input.
    public static func durationCompact(_ seconds: Double?) -> String? {
        guard let seconds, seconds.isFinite, seconds >= 0 else { return nil }
        let minutes = Int(seconds / 60)
        let hours = minutes / 60
        let remaining = minutes % 60
        if hours > 0 { return "\(hours)h \(remaining)m" }
        return "\(remaining)m"
    }

    /// ContinueListeningView / BookView rendering: rounding, zero-padded, "0:00" fallback.
    public static func durationClock(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds > 0 else { return "0:00" }
        let total = Int(seconds.rounded())
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        if hours > 0 { return "\(hours)h \(String(format: "%02dm", minutes))" }
        return "\(minutes)m"
    }

    /// `useAll: true` matches ActivityView/DownloadClientView; `false` matches MediaDetailView.
    public static func speed(_ bytesPerSecond: Double, useAll: Bool) -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .binary
        if useAll { formatter.allowedUnits = [.useAll] }
        // Non-finite/overflowing rates would trap the non-failable Int64 init.
        let safeBytes = max(0, Int64(exactly: bytesPerSecond.rounded()) ?? 0)
        return "\(formatter.string(fromByteCount: safeBytes))/s"
    }

    /// MediaDetailView rendering: echoes the raw string when it does not parse.
    public static func bytesEcho(_ raw: String) -> String {
        guard let value = Int64(raw) else { return raw }
        return ByteCountFormatter.string(fromByteCount: value, countStyle: .file)
    }

    /// BookView rendering: nil when absent or non-positive (callers then omit the metric).
    public static func bytesStrict(_ raw: String?) -> String? {
        guard let raw, let bytes = Int64(raw), bytes > 0 else { return nil }
        return ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
    }
}
