import RawkoonKit
import SwiftUI

struct ReencodeTarget: Identifiable {
    let id = UUID()
    let selection: TranscodeSelection
    let subtitle: String
}

/// Native counterpart of the web re-encode modal.
struct ReencodeSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let target: ReencodeTarget
    let onQueued: (Int) -> Void

    @State private var settings = TranscodeJobSettings()
    @State private var gbPerFile = 1.5
    @State private var qualityText = ""
    @State private var caps: TranscodeCapabilities?
    /// Quality-mode estimate for the current video/audio choices; also feeds the target-mode bitrate.
    @State private var base: TranscodeEstimate?
    @State private var targetEstimate: TranscodeEstimate?
    @State private var refined: (settings: TranscodeJobSettings, estimate: TranscodeEstimate)?
    @State private var refining = false
    @State private var submitting = false

    private var qualitySettings: TranscodeJobSettings {
        var s = settings
        s.mode = .quality
        s.targetVideoKbps = nil
        return s
    }

    private var effectiveSettings: TranscodeJobSettings {
        guard settings.mode == .target, let base else { return qualitySettings }
        var s = settings
        s.targetVideoKbps = TranscodeMath.targetKbps(
            gbPerFile: gbPerFile,
            fileCount: base.files.count,
            totalAudioBytes: Double(base.totalAudioBytes) ?? 0,
            totalDurationSecs: base.totalDurationSecs
        )
        return s
    }

    private var shownEstimate: TranscodeEstimate? {
        if settings.mode == .target {
            return targetEstimate
        }
        if let refined, refined.settings == effectiveSettings {
            return refined.estimate
        }
        return base
    }

    private var outdated: Bool {
        settings.mode == .quality && refined != nil && refined?.settings != effectiveSettings
    }

    private var eligibleCount: Int {
        shownEstimate?.files.count ?? base?.files.count ?? 0
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(verbatim: target.subtitle).foregroundStyle(Theme.muted).listRowBackground(Theme.raised)
                }
                videoSection
                sizeSection
                audioSection
                if let excluded = shownEstimate?.excluded, !excluded.isEmpty {
                    Section {
                        DisclosureGroup("\(excluded.count) files skipped") {
                            ForEach(excluded) { x in
                                Text(verbatim: "\(x.title) — \(x.reason)").font(.caption).foregroundStyle(Theme.muted)
                            }
                        }
                        .listRowBackground(Theme.raised)
                    }
                }
                Section {
                    ReencodeEstimateCard(
                        estimate: shownEstimate,
                        mode: settings.mode,
                        outdated: outdated,
                        refining: refining,
                        canRefine: eligibleCount > 0,
                        onRefine: { Task { await refine() } }
                    )
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.base)
            .tint(Theme.apricot)
            .navigationTitle("Re-encode")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add \(eligibleCount) files") { Task { await submit() } }
                        .disabled(eligibleCount == 0 || submitting)
                }
            }
            .task { await loadCapabilities() }
            .task(id: qualitySettings) {
                try? await Task.sleep(for: .milliseconds(300))
                guard !Task.isCancelled else { return }
                base = await fetch(qualitySettings, refine: false) ?? base
            }
            .task(id: settings.mode == .target ? effectiveSettings : nil) {
                guard settings.mode == .target, base != nil else { return }
                try? await Task.sleep(for: .milliseconds(300))
                guard !Task.isCancelled else { return }
                targetEstimate = await fetch(effectiveSettings, refine: false) ?? targetEstimate
            }
        }
    }

    // MARK: Sections

    private var videoSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                Text("Codec").font(.footnote).foregroundStyle(Theme.muted)
                Picker("Codec", selection: $settings.codec) {
                    Text(verbatim: "HEVC").tag(TranscodeCodec.hevc)
                    Text(verbatim: "AV1").tag(TranscodeCodec.av1)
                }
                .pickerStyle(.segmented)
                Text(settings.codec == .hevc ? LocalizedStringKey("Widest support") : LocalizedStringKey("Smallest files"))
                    .font(.caption2).foregroundStyle(Theme.faint)
            }
            .listRowBackground(Theme.raised)
            VStack(alignment: .leading, spacing: 6) {
                Text("Encoder").font(.footnote).foregroundStyle(Theme.muted)
                Picker("Encoder", selection: $settings.encoder) {
                    Text("CPU").tag(TranscodeEncoder.software)
                    Text("GPU").tag(TranscodeEncoder.vaapi)
                }
                .pickerStyle(.segmented)
                .disabled(!(caps?.supports(settings.codec, .vaapi) ?? false))
            }
            .listRowBackground(Theme.raised)
            VStack(alignment: .leading, spacing: 6) {
                Text("Resolution").font(.footnote).foregroundStyle(Theme.muted)
                Picker("Resolution", selection: $settings.resolution) {
                    Text("Keep").tag(TranscodeResolution.keep)
                    if !fits(.p1080) {
                        Text(verbatim: "1080p").tag(TranscodeResolution.p1080)
                    }
                    if !fits(.p720) {
                        Text(verbatim: "720p").tag(TranscodeResolution.p720)
                    }
                }
                .pickerStyle(.segmented)
            }
            .listRowBackground(Theme.raised)
        } header: {
            Text("Video")
        } footer: {
            if let label = caps?.deviceLabel {
                Text("Detected: \(label)")
            } else if let reason = caps?.vaapiUnavailableReason {
                Text(verbatim: reason)
            }
        }
        .onChange(of: settings.codec) { _, codec in
            if !(caps?.supports(codec, settings.encoder) ?? true) {
                settings.encoder = .software
            }
        }
    }

    private var sizeSection: some View {
        Section("Size") {
            Picker("Mode", selection: $settings.mode) {
                Text("Quality").tag(TranscodeMode.quality)
                Text("Target size").tag(TranscodeMode.target)
            }
            .pickerStyle(.segmented)
            .listRowBackground(Theme.raised)
            if settings.mode == .quality {
                Picker("Preset", selection: $settings.preset) {
                    Text("High").tag(TranscodePreset.high)
                    Text("Balanced").tag(TranscodePreset.balanced)
                    Text("Small").tag(TranscodePreset.small)
                }
                .pickerStyle(.segmented)
                .listRowBackground(Theme.raised)
                .onChange(of: settings.preset) { _, _ in
                    settings.quality = nil
                    qualityText = ""
                }
                DisclosureGroup("Advanced") {
                    HStack {
                        Text("Quality value")
                        Spacer()
                        TextField(settings.encoder == .vaapi ? "QP" : "CRF", text: $qualityText)
                            .keyboardType(.numberPad).multilineTextAlignment(.trailing).frame(width: 70)
                            .onChange(of: qualityText) { _, text in settings.quality = Int(text) }
                    }
                    if settings.encoder == .software {
                        Picker("Speed", selection: $settings.speed) {
                            Text("Slower").tag(TranscodeSpeed.slower)
                            Text("Default").tag(TranscodeSpeed.default)
                            Text("Faster").tag(TranscodeSpeed.faster)
                        }
                        .pickerStyle(.segmented)
                    }
                }
                .listRowBackground(Theme.raised)
            } else {
                HStack {
                    Text("GB per file (average)")
                    Spacer()
                    TextField("GB", value: $gbPerFile, format: .number.precision(.fractionLength(1)))
                        .keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(width: 70)
                }
                .listRowBackground(Theme.raised)
                if let kbps = effectiveSettings.targetVideoKbps {
                    Text("≈ \(String(format: "%.1f", Double(kbps) / 1000)) Mbps video")
                        .font(.caption).foregroundStyle(Theme.muted).listRowBackground(Theme.raised)
                }
            }
        }
    }

    private var audioSection: some View {
        Section {
            Toggle("Convert lossless audio to EAC3", isOn: $settings.convertLosslessAudio)
                .listRowBackground(Theme.raised)
            let changes = base?.audioChanges ?? []
            if changes.isEmpty {
                Text("No lossless audio tracks.").font(.caption).foregroundStyle(Theme.muted).listRowBackground(Theme.raised)
            }
            ForEach(changes) { change in
                HStack {
                    Text(verbatim: change.label).font(.caption).foregroundStyle(Theme.muted)
                    Spacer()
                    if settings.convertLosslessAudio {
                        Text(verbatim: "→ \(change.to)").font(.caption).foregroundStyle(Theme.apricot)
                    } else {
                        Text("copy").font(.caption).foregroundStyle(Theme.faint)
                    }
                }
                .listRowBackground(Theme.raised)
            }
        } header: {
            Text("Audio & subtitles")
        } footer: {
            Text("Lossy tracks and all subtitles are always copied untouched.")
        }
    }

    // MARK: Actions

    private func fits(_ r: TranscodeResolution) -> Bool {
        guard let box = r.box, let e = base else { return false }
        return TranscodeMath.fitsBox(sourceWidth: e.sourceWidth, sourceHeight: e.sourceHeight, boxWidth: box.width, boxHeight: box.height)
    }

    private func loadCapabilities() async {
        guard let client = model.api() else { return }
        caps = try? await client.transcodeCapabilities()
    }

    private func fetch(_ s: TranscodeJobSettings, refine: Bool) async -> TranscodeEstimate? {
        guard let client = model.api() else { return nil }
        return try? await client.transcodeEstimate(selection: target.selection, settings: s, refine: refine)
    }

    private func refine() async {
        let s = effectiveSettings
        refining = true
        defer { refining = false }
        if let e = await fetch(s, refine: true) {
            refined = (s, e)
        } else {
            model.toast(String(localized: "Couldn't refine the estimate."), style: .error)
        }
    }

    private func submit() async {
        guard let client = model.api() else { return }
        submitting = true
        defer { submitting = false }
        do {
            let r = try await client.enqueueTranscode(selection: target.selection, settings: effectiveSettings)
            onQueued(r.count)
            dismiss()
        } catch {
            model.toast(String(localized: "Couldn't add to the re-encode queue."), style: .error)
        }
    }
}
