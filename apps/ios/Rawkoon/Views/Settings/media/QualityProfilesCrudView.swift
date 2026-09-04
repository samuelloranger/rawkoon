import SwiftUI

/// Media quality profiles CRUD (admin). List + editor. `GET/POST/PUT/DELETE
/// /api/quality-profiles`. Custom-format assignment reads `/api/custom-formats`.
struct QualityProfilesCrudView: View {
    @Environment(AppModel.self) private var model

    @State private var profiles: [QualityProfile] = []
    @State private var formats: [CustomFormatDTO] = []
    @State private var loading = true
    @State private var loadError: String?
    @State private var busyIds: Set<Int> = []
    @State private var loadGen = 0

    var body: some View {
        Group {
            if !model.isAdmin {
                ContentUnavailableView("Admin only", systemImage: "lock")
            } else {
                list
            }
        }
        .navigationTitle("Quality profiles")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var list: some View {
        Form {
            SettingsStateView(isLoading: loading, error: loadError, retry: { Task { await load() } }) {
                if profiles.isEmpty {
                    Text("No profiles yet.").foregroundStyle(Theme.muted)
                        .listRowBackground(Theme.raised)
                }
                ForEach(profiles) { profile in
                    NavigationLink {
                        QualityProfileEditorView(profile: profile, formats: formats)
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(profile.name).foregroundStyle(Theme.text)
                            Text(resolutionLabel(profile.minResolution) + " min")
                                .font(.footnote).foregroundStyle(Theme.muted)
                        }
                    }
                    .listRowBackground(Theme.raised)
                    .swipeActions {
                        Button("Delete", role: .destructive) { Task { await delete(profile) } }
                            .disabled(busyIds.contains(profile.id))
                    }
                    .overlay(alignment: .trailing) {
                        if busyIds.contains(profile.id) {
                            ProgressView().tint(Theme.muted).padding(.trailing, 4)
                        }
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.base)
        .tint(Theme.apricot)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink {
                    QualityProfileEditorView(profile: nil, formats: formats)
                } label: {
                    Image(systemName: "plus")
                }
            }
        }
        .onAppear { Task { await load() } }
    }

    private func resolutionLabel(_ value: Int?) -> String {
        guard let value else { return "—" }
        return "\(value)p"
    }

    private func load() async {
        guard let client = model.api() else { loading = false; return }
        loading = true; loadError = nil
        do {
            let gen = loadGen
            let fetched = try await client.qualityProfiles().profiles
            if gen == loadGen {
                profiles = fetched
            }
            formats = await (try? client.customFormats().customFormats) ?? []
        } catch {
            loadError = settingsErrorMessage(error)
        }
        loading = false
    }

    private func delete(_ profile: QualityProfile) async {
        guard let client = model.api(), !busyIds.contains(profile.id) else { return }
        busyIds.insert(profile.id)
        defer { busyIds.remove(profile.id) }
        loadGen &+= 1
        guard let idx = profiles.firstIndex(where: { $0.id == profile.id }) else { return }
        let removed = profiles[idx]
        profiles.remove(at: idx) // optimistic (single element)
        do {
            try await client.deleteQualityProfile(id: profile.id)
            model.toast("Profile deleted.", style: .success)
        } catch {
            if !profiles.contains(where: { $0.id == removed.id }) {
                profiles.insert(removed, at: min(idx, profiles.count)) // restore just this row
            }
            model.toast(settingsErrorMessage(error), style: .error)
        }
    }
}

private struct QualityProfileEditorView: View {
    let profile: QualityProfile?
    let formats: [CustomFormatDTO]

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var minResolution = 1080
    @State private var cutoffResolution: Int? = nil
    @State private var sources: Set<String> = []
    @State private var codecs: Set<String> = []
    @State private var languages: Set<String> = []
    @State private var searchLanguage: String? = nil
    @State private var trackersText = ""
    @State private var preferTracker = false
    @State private var maxSizeText = ""
    @State private var minSeeders: Int? = 0
    @State private var requireHdr = false
    @State private var preferHdr = false
    @State private var scores: [Int: Int] = [:] // customFormatId -> score (included when present)

    @State private var saving = false
    @State private var saveError: String?

    private static let resolutionOptions: [(value: Int, label: LocalizedStringKey)] = [
        (480, "480p"), (720, "720p"), (1080, "1080p"), (2160, "2160p"),
    ]
    private var cutoffOptions: [(value: Int?, label: LocalizedStringKey)] {
        [(nil, "None")] + Self.resolutionOptions.map { (Optional($0.value), $0.label) }
    }

    private static let sourceOptions: [(value: String, label: LocalizedStringKey)] = [
        ("REMUX", "REMUX"), ("BluRay", "BluRay"), ("WEB-DL", "WEB-DL"), ("WEBRip", "WEBRip"), ("HDTV", "HDTV"),
    ]
    private static let codecOptions: [(value: String, label: LocalizedStringKey)] = [
        ("HEVC", "HEVC"), ("AVC", "AVC"), ("AV1", "AV1"), ("VP9", "VP9"),
    ]
    private static let languageOptions: [(value: String, label: LocalizedStringKey)] = [
        ("en", "English"), ("fr", "French"), ("VFQ", "VFQ"), ("TRUEFRENCH", "TRUEFRENCH"),
        ("de", "German"), ("es", "Spanish"), ("it", "Italian"), ("ja", "Japanese"), ("pt", "Portuguese"),
    ]
    private var searchLanguageOptions: [(value: String?, label: LocalizedStringKey)] {
        let named: [(String, LocalizedStringKey)] = [
            ("en", "English"), ("fr", "French"), ("de", "German"), ("es", "Spanish"),
            ("it", "Italian"), ("ja", "Japanese"), ("ko", "Korean"), ("pt", "Portuguese"), ("zh", "Chinese"),
        ]
        return [(nil, "Default (English)")] + named.map { (Optional($0.0), $0.1) }
    }

    var body: some View {
        Form {
            Section {
                LabeledTextFieldRow(title: "Name", text: $name, autocaps: true)
                PickerRow(title: "Min resolution", selection: $minResolution, options: Self.resolutionOptions)
                PickerRow(title: "Cutoff", selection: $cutoffResolution, options: cutoffOptions)
            }
            Section {
                MultiSelectRow(title: "Preferred sources", selected: $sources, options: Self.sourceOptions)
                MultiSelectRow(title: "Preferred codecs", selected: $codecs, options: Self.codecOptions)
                MultiSelectRow(title: "Preferred languages", selected: $languages, options: Self.languageOptions)
                PickerRow(title: "Search title language", selection: $searchLanguage, options: searchLanguageOptions)
            }
            Section {
                Toggle("Prefer HDR", isOn: $preferHdr).tint(Theme.apricot).listRowBackground(Theme.raised)
                Toggle("Require HDR", isOn: $requireHdr).tint(Theme.apricot).listRowBackground(Theme.raised)
                NumberFieldRow("Min seeders", value: $minSeeders, range: 0 ... 100_000)
                LabeledTextFieldRow(title: "Max size (GB)", text: $maxSizeText, keyboard: .decimalPad)
            }
            Section {
                LabeledTextFieldRow(title: "Prioritized trackers", text: $trackersText,
                                    placeholder: "comma-separated")
                Toggle("Prefer tracker over quality", isOn: $preferTracker)
                    .tint(Theme.apricot).listRowBackground(Theme.raised)
            } footer: {
                Text("Tracker slugs, in priority order, comma-separated.")
            }
            if !formats.isEmpty {
                Section {
                    ForEach(formats) { format in
                        customFormatRow(format)
                    }
                } header: {
                    Text("Custom formats")
                }
            }
            if let saveError {
                Section { Text(saveError).foregroundStyle(Theme.terracotta) }
                    .listRowBackground(Theme.raised)
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.base)
        .tint(Theme.apricot)
        .navigationTitle(Text(LocalizedStringKey(profile == nil ? "New profile" : "Edit profile")))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if saving {
                    ProgressView().tint(Theme.apricot)
                } else {
                    Button("Save") { Task { await save() } }.disabled(name.isEmpty)
                }
            }
        }
        .onAppear(perform: seed)
    }

    private func customFormatRow(_ format: CustomFormatDTO) -> some View {
        let included = scores[format.id] != nil
        return HStack {
            Button {
                if included {
                    scores[format.id] = nil
                } else {
                    scores[format.id] = 0
                }
            } label: {
                Image(systemName: included ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(included ? Theme.apricot : Theme.muted)
            }
            .buttonStyle(.borderless)
            Text(format.name).foregroundStyle(Theme.text)
            Spacer()
            if included {
                TextField("0", value: Binding(
                    get: { scores[format.id] ?? 0 },
                    set: { scores[format.id] = $0 }
                ), format: .number)
                    .keyboardType(.numbersAndPunctuation)
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 70)
                    .foregroundStyle(Theme.text)
            }
        }
        .listRowBackground(Theme.raised)
    }

    private func seed() {
        guard let profile else { return }
        name = profile.name
        minResolution = profile.minResolution ?? 1080
        cutoffResolution = profile.cutoffResolution
        sources = Set(profile.preferredSources ?? [])
        codecs = Set(profile.preferredCodecs ?? [])
        languages = Set(profile.preferredLanguages ?? [])
        searchLanguage = profile.preferredSearchLanguage
        trackersText = (profile.prioritizedTrackers ?? []).joined(separator: ", ")
        preferTracker = profile.preferTrackerOverQuality ?? false
        maxSizeText = profile.maxSizeGb.map { String($0) } ?? ""
        minSeeders = profile.minSeeders ?? 0
        requireHdr = profile.requireHdr ?? false
        preferHdr = profile.preferHdr ?? false
        var seededScores: [Int: Int] = [:]
        for assignment in profile.customFormats ?? [] {
            if let id = assignment.customFormatId {
                seededScores[id] = assignment.score ?? 0
            }
        }
        scores = seededScores
    }

    private func body_() -> SaveQualityProfileBody {
        let trackers = trackersText.split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        let assignments = scores.map {
            CustomFormatAssignmentBody(customFormatId: $0.key, score: $0.value, required: false, forbidden: false)
        }
        return SaveQualityProfileBody(
            name: name.trimmingCharacters(in: .whitespaces),
            minResolution: minResolution,
            cutoffResolution: cutoffResolution,
            preferredSources: Array(sources),
            preferredCodecs: Array(codecs),
            preferredLanguages: Array(languages),
            preferredSearchLanguage: searchLanguage,
            prioritizedTrackers: trackers,
            preferTrackerOverQuality: preferTracker,
            maxSizeGb: Double(maxSizeText),
            requireHdr: requireHdr,
            preferHdr: preferHdr,
            minSeeders: minSeeders ?? 0,
            customFormats: assignments
        )
    }

    private func save() async {
        guard let client = model.api() else { return }
        saving = true; saveError = nil
        do {
            if let profile {
                try await client.updateQualityProfile(id: profile.id, body_())
            } else {
                try await client.createQualityProfile(body_())
            }
            dismiss()
        } catch {
            saveError = settingsErrorMessage(error)
        }
        saving = false
    }
}
