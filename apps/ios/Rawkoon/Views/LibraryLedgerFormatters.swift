import Foundation

/// Pure formatters for the library "ledger" row metadata (size, resolution,
/// codec, duration). Ported 1:1 from the web's
/// `apps/web/src/pages/medias/_component/LibraryItemRow.tsx` so native and
/// web read the same numbers the same way. No view code here — consumed by
/// the (later) density row in `LibraryView`.
enum LibraryLedgerFormatters {
    /// `total_size_bytes` is a bigint serialized as a decimal string.
    static func formatBytes(_ bytesString: String?) -> String? {
        guard let bytesString, let n = Double(bytesString), n > 0 else { return nil }
        if n >= 1e12 {
            return String(localized: "\(n / 1e12, specifier: "%.1f") TB")
        }
        if n >= 1e9 {
            return String(localized: "\(n / 1e9, specifier: "%.1f") GB")
        }
        if n >= 1e6 {
            return String(localized: "\(n / 1e6, specifier: "%.1f") MB")
        }
        return String(localized: "\(Int(n)) B")
    }

    /// `resolution` is the source's vertical pixel count (e.g. 1080, 2160).
    static func formatResolution(_ resolution: Int?) -> String? {
        guard let resolution, resolution > 0 else { return nil }
        if resolution >= 2160 {
            return "4K"
        }
        if resolution >= 1080 {
            return "1080p"
        }
        if resolution >= 720 {
            return "720p"
        }
        if resolution >= 576 {
            return "576p"
        }
        return "480p"
    }

    static func formatCodec(_ codec: String?) -> String? {
        guard let codec, !codec.isEmpty else { return nil }
        let normalized = codec.lowercased().replacingOccurrences(
            of: "[.\\s-]", with: "", options: .regularExpression
        )
        if normalized.contains("hevc") || normalized.contains("h265") {
            return "H.265"
        }
        if normalized.contains("avc") || normalized.contains("h264") {
            return "H.264"
        }
        if normalized == "av1" {
            return "AV1"
        }
        if normalized == "vp9" {
            return "VP9"
        }
        return codec.uppercased()
    }

    static func formatDuration(_ secs: Double?) -> String? {
        guard let secs, secs >= 60 else { return nil }
        let h = Int(secs) / 3600
        let m = (Int(secs) % 3600) / 60
        if h > 0 {
            return String(localized: "\(h)h \(m)m")
        }
        return String(localized: "\(m)m")
    }
}
