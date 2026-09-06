import RawkoonKit
import SwiftUI

/// One media file in the detail "Files" section — a collapsible row that expands
/// to full track detail and (for MKVs with multiple audio tracks) an admin-only
/// remux panel. Owns its own expansion + remux state so the parent list stays
/// lean. Destructive delete is surfaced via a context menu but confirmed by the
/// parent, which owns the confirmation dialog.
struct DetailFileRow: View {
    enum Mode { case movie, episode }

    @Environment(AppModel.self) private var model

    let file: LibraryFileInfo
    let mode: Mode
    let isAdmin: Bool
    let onChanged: () -> Void
    let onNotice: (String) -> Void
    let onError: (String) -> Void
    let onRequestDelete: () -> Void

    @State private var expanded = false
    @State private var remuxOpen = false
    @State private var remuxKeepAudio: Set<Int> = []
    @State private var remuxKeepSubtitle: Set<Int> = []
    @State private var remuxStarting = false
    @State private var remuxRunning = false

    var body: some View {
        VStack(spacing: 0) {
            Button {
                expanded.toggle()
            } label: {
                header
                    .padding(10)
                    .background(Theme.base.opacity(0.25), in: RoundedRectangle(cornerRadius: 10))
            }
            .buttonStyle(.plain)

            if expanded {
                detailBlock
                    .padding(.top, 8)
            }
        }
        .rawkoonMotion(RawkoonMotion.snappy, value: expanded)
        .contextMenu {
            // Movie files delete via the generic file route; episode files are
            // deleted from the seasons section, which has the episode id.
            if isAdmin, mode == .movie {
                Button(role: .destructive) {
                    onRequestDelete()
                } label: {
                    Label("Delete file", systemImage: "trash")
                }
            }
        }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 8) {
            if mode == .episode {
                Text(file.episode.map { "E\(String(format: "%02d", $0))" } ?? "--")
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(Theme.faint)
                    .frame(width: 30, alignment: .leading)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(mode == .episode ? (file.episodeTitle ?? file.fileName) : file.fileName)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(Theme.textStrong)
                    .lineLimit(2)
                HStack(spacing: 6) {
                    Text(Formatters.bytesEcho(file.sizeBytes))
                    if let duration = Formatters.durationCompact(file.durationSecs) {
                        Text(duration)
                    }
                    if let res = resolutionText(for: file) {
                        Text(res)
                    }
                }
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Theme.muted)
            }
            Spacer()
            Image(systemName: expanded ? "chevron.down" : "chevron.right")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(Theme.faint)
        }
    }

    private var detailBlock: some View {
        let isMkv = file.fileName.lowercased().hasSuffix(".mkv")
        let canRemux = isAdmin && isMkv && file.audioTracks.count > 1

        return VStack(alignment: .leading, spacing: 6) {
            lineItem("Path", file.filePath)
            lineItem("Release group", file.releaseGroup ?? "Unknown")
            lineItem("Codec", [file.videoCodec, file.videoProfile].compactMap(\.self).joined(separator: " · "))
            lineItem("Source", file.source ?? "Unknown")
            lineItem("HDR", file.hdrFormat ?? "None")
            lineItem("Bit depth", file.bitDepth.map { "\($0)-bit" } ?? "Unknown")
            lineItem("Frame rate", file.frameRate.map { String(format: "%.2f fps", $0) } ?? "Unknown")
            lineItem("Video bitrate", file.videoBitrate.map { "\($0) kbps" } ?? "Unknown")

            audioTracksBlock(file.audioTracks)
            subtitleTracksBlock(file.subtitleTracks)

            HStack {
                if let scanned = scannedDate(file.scannedAt) {
                    Text("Scanned \(scanned)")
                        .font(.caption2)
                        .foregroundStyle(Theme.faint)
                }
                Spacer()
                if canRemux, !remuxOpen {
                    Button {
                        openRemux()
                    } label: {
                        Label("Remux", systemImage: "shuffle")
                            .font(.caption.weight(.medium))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.apricot)
                }
            }
            .padding(.top, 2)

            if remuxOpen {
                remuxPanel
            }
        }
        .padding(10)
        .background(Theme.well, in: RoundedRectangle(cornerRadius: 10))
    }

    // MARK: Tracks

    @ViewBuilder
    private func audioTracksBlock(_ tracks: [LibraryAudioTrack]) -> some View {
        if tracks.isEmpty {
            lineItem("Audio", "None")
        } else {
            VStack(alignment: .leading, spacing: 4) {
                Text("Audio (\(tracks.count))")
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(Theme.faint)
                ForEach(tracks) { tr in
                    trackRow(
                        lang: audioLanguage(tr),
                        details: audioDetails(tr),
                        badges: audioBadges(tr)
                    )
                }
            }
        }
    }

    @ViewBuilder
    private func subtitleTracksBlock(_ tracks: [LibrarySubtitleTrack]) -> some View {
        if tracks.isEmpty {
            lineItem("Subtitles", "None")
        } else {
            VStack(alignment: .leading, spacing: 4) {
                Text("Subtitles (\(tracks.count))")
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(Theme.faint)
                ForEach(tracks) { tr in
                    trackRow(
                        lang: subtitleLanguage(tr),
                        details: subtitleDetails(tr),
                        badges: subtitleBadges(tr)
                    )
                }
            }
        }
    }

    private func trackRow(lang: String, details: String, badges: [(String, Color)]) -> some View {
        HStack(spacing: 8) {
            Text(lang)
                .font(.caption2.weight(.medium))
                .foregroundStyle(Theme.muted)
                .frame(width: 96, alignment: .leading)
                .lineLimit(1)
            Text(details.isEmpty ? "—" : details)
                .font(.caption2)
                .foregroundStyle(Theme.faint)
                .lineLimit(1)
            Spacer(minLength: 0)
            ForEach(Array(badges.enumerated()), id: \.offset) { _, badge in
                trackBadge(badge.0, color: badge.1)
            }
        }
    }

    private func trackBadge(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.system(size: 9, weight: .semibold))
            .padding(.horizontal, 5)
            .padding(.vertical, 2)
            .background(color.opacity(0.15), in: Capsule())
            .foregroundStyle(color)
    }

    // MARK: Remux

    @ViewBuilder
    private var remuxPanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("REMUX")
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Theme.faint)

            VStack(alignment: .leading, spacing: 6) {
                Text("Keep audio tracks")
                    .font(.caption2)
                    .foregroundStyle(Theme.faint)
                ForEach(file.audioTracks) { tr in
                    remuxToggleRow(
                        kept: remuxKeepAudio.contains(tr.index),
                        lang: audioLanguage(tr),
                        details: audioDetails(tr)
                    ) { toggleRemuxAudio(tr.index) }
                }
            }

            if !file.subtitleTracks.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Keep subtitle tracks")
                        .font(.caption2)
                        .foregroundStyle(Theme.faint)
                    ForEach(file.subtitleTracks) { tr in
                        remuxToggleRow(
                            kept: remuxKeepSubtitle.contains(tr.index),
                            lang: subtitleLanguage(tr),
                            details: subtitleDetails(tr)
                        ) { toggleRemuxSubtitle(tr.index) }
                    }
                }
            }

            HStack(spacing: 12) {
                if remuxRunning || remuxStarting {
                    ProgressView().tint(Theme.muted)
                    Text(LocalizedStringKey(remuxStarting ? "Starting…" : "Remuxing…"))
                        .font(.caption2)
                        .foregroundStyle(Theme.muted)
                } else {
                    Button("Start remux") {
                        Task { await startRemux() }
                    }
                    .font(.caption.weight(.medium))
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.apricot)
                    .disabled(remuxKeepAudio.isEmpty)
                    Button("Cancel") { closeRemux() }
                        .font(.caption)
                        .buttonStyle(.plain)
                        .foregroundStyle(Theme.faint)
                }
            }
            .padding(.top, 2)
        }
        .padding(10)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 10))
    }

    private func remuxToggleRow(
        kept: Bool,
        lang: String,
        details: String,
        toggle: @escaping () -> Void
    ) -> some View {
        Button(action: toggle) {
            HStack(spacing: 8) {
                Image(systemName: kept ? "checkmark.square.fill" : "square")
                    .font(.caption)
                    .foregroundStyle(kept ? Theme.apricot : Theme.faint)
                Text(lang)
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(Theme.muted)
                    .frame(width: 90, alignment: .leading)
                    .lineLimit(1)
                Text(details.isEmpty ? "—" : details)
                    .font(.caption2)
                    .foregroundStyle(Theme.faint)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
            .opacity(kept ? 1 : 0.5)
        }
        .buttonStyle(.plain)
        .disabled(remuxRunning || remuxStarting)
    }

    private func openRemux() {
        remuxOpen = true
        remuxKeepAudio = Set(file.audioTracks.map(\.index))
        remuxKeepSubtitle = Set(file.subtitleTracks.map(\.index))
        remuxStarting = false
        remuxRunning = false
    }

    private func closeRemux() {
        remuxOpen = false
        remuxKeepAudio = []
        remuxKeepSubtitle = []
        remuxStarting = false
        remuxRunning = false
    }

    private func toggleRemuxAudio(_ index: Int) {
        if remuxKeepAudio.contains(index) {
            if remuxKeepAudio.count <= 1 {
                return // keep at least one audio track
            }
            remuxKeepAudio.remove(index)
        } else {
            remuxKeepAudio.insert(index)
        }
    }

    private func toggleRemuxSubtitle(_ index: Int) {
        if remuxKeepSubtitle.contains(index) {
            remuxKeepSubtitle.remove(index)
        } else {
            remuxKeepSubtitle.insert(index)
        }
    }

    private func startRemux() async {
        guard let client = model.api() else {
            onError(String(localized: "Not logged in."))
            return
        }
        remuxStarting = true
        do {
            _ = try await client.remuxFile(
                fileId: file.id,
                keepAudioTrackIndices: remuxKeepAudio.sorted(),
                keepSubtitleTrackIndices: remuxKeepSubtitle.sorted()
            )
            remuxStarting = false
            remuxRunning = true
            await pollRemux()
        } catch {
            remuxStarting = false
            onError(String(localized: "Could not start remux."))
        }
    }

    private func pollRemux() async {
        guard let client = model.api() else { return }
        for _ in 0 ..< 150 { // ~5 min cap at a 2s interval
            try? await Task.sleep(for: .seconds(2))
            if !remuxOpen {
                return // panel closed
            }
            guard let status = try? await client.remuxFileStatus(fileId: file.id) else { continue }
            switch status.state {
            case "completed":
                switch status.result?.status {
                case "remuxed": onNotice(String(localized: "Remux complete."))
                case "skipped": onNotice(String(localized: "Remux skipped — nothing to change."))
                default: onError(status.result?.message ?? String(localized: "Remux failed."))
                }
                closeRemux()
                onChanged()
                return
            case "failed":
                onError(status.error ?? String(localized: "Remux failed."))
                closeRemux()
                onChanged()
                return
            default:
                continue
            }
        }
        remuxRunning = false
        onNotice(String(localized: "Remux still running in the background."))
    }

    // MARK: Track formatting

    private func lineItem(_ label: String, _ value: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text(label)
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(Theme.faint)
                .frame(width: 90, alignment: .leading)
            Text(value.isEmpty ? "Unknown" : value)
                .font(.caption2)
                .foregroundStyle(Theme.muted)
                .multilineTextAlignment(.leading)
            Spacer(minLength: 0)
        }
    }

    private func resolutionText(for file: LibraryFileInfo) -> String? {
        if let res = file.resolution {
            return "\(res)p"
        }
        if let width = file.width, let height = file.height {
            return "\(width)x\(height)"
        }
        return nil
    }

    private func scannedDate(_ isoDate: String) -> String? {
        guard let date = ISO8601DateFormatter().date(from: isoDate) else { return nil }
        return DateFormatter.localizedString(from: date, dateStyle: .medium, timeStyle: .short)
    }

    private func frenchLabel(_ lang: String?) -> String? {
        guard let lang else { return nil }
        switch lang.uppercased() {
        case "VFF": return "VFF (France)"
        case "VFQ": return "VFQ (Québec)"
        case "VFI": return "VFI (International)"
        case "VF2": return "VF2"
        case "TRUEFRENCH": return "TRUEFRENCH"
        default: return nil
        }
    }

    private func audioLanguage(_ tr: LibraryAudioTrack) -> String {
        frenchLabel(tr.language) ?? tr.languageName ?? tr.language ?? "—"
    }

    private func audioDetails(_ tr: LibraryAudioTrack) -> String {
        [
            tr.codec,
            tr.channelLayout ?? tr.channels.map { "\($0)ch" },
            tr.bitrateKbps.map { "\($0) kbps" },
        ]
        .compactMap(\.self)
        .joined(separator: " · ")
    }

    private func audioBadges(_ tr: LibraryAudioTrack) -> [(String, Color)] {
        var badges: [(String, Color)] = []
        if tr.isDefault {
            badges.append(("Default", Theme.apricot))
        }
        if tr.forced {
            badges.append(("Forced", Theme.muted))
        }
        return badges
    }

    private func subtitleLanguage(_ tr: LibrarySubtitleTrack) -> String {
        frenchLabel(tr.language) ?? tr.languageName ?? tr.language ?? "—"
    }

    private func subtitleDetails(_ tr: LibrarySubtitleTrack) -> String {
        [tr.format, tr.title]
            .compactMap(\.self)
            .joined(separator: " · ")
    }

    private func subtitleBadges(_ tr: LibrarySubtitleTrack) -> [(String, Color)] {
        var badges: [(String, Color)] = []
        if tr.forced {
            badges.append(("Forced", Theme.muted))
        }
        if tr.hearingImpaired {
            badges.append(("HI", Theme.muted))
        }
        return badges
    }
}
