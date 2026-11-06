import RawkoonKit
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
                    .rawkoonLivingSymbol(.empty)
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
                            .requiresConnection(model.isOffline)
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
        .readableWidth()
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
            model.toast(String(localized: "Profile deleted."), style: .success)
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
    // Arrays, not Sets: the server scores by position, so order must survive a save.
    @State private var sources: [String] = []
    @State private var codecs: [String] = []
    @State private var languages: [String] = []
    @State private var searchLanguage: String? = nil
    /// Ordered, like the sources: the server ranks trackers by position.
    @State private var trackers: [String] = []
    @State private var newTracker = ""
    @State private var preferTracker = false
    @State private var maxSizeText = ""
    @State private var minSeeders: Int? = 0
    @State private var grabDelayMinutes: Int? = 0
    @State private var bypassDelayIfCutoffMet = true
    @State private var requireHdr = false
    @State private var preferHdr = false
    @State private var scores: [Int: Int] = [:] // customFormatId -> score (included when present)
    @State private var stances: [Int: FormatStance] = [:] // customFormatId -> required/forbidden/neither

    /// Per-format scoring stance, mutually exclusive (mirrors the web editor).
    private enum FormatStance: String, CaseIterable, Identifiable {
        case neither, required, forbidden
        var id: String {
            rawValue
        }

        var label: LocalizedStringKey {
            switch self {
            case .neither: "—"
            case .required: "Required"
            case .forbidden: "Forbidden"
            }
        }
    }

    @State private var saving = false
    @State private var saveError: String?

    private static let resolutionOptions: [(value: Int, label: LocalizedStringKey)] = [
        (480, "480p"), (720, "720p"), (1080, "1080p"), (2160, "2160p"),
    ]
    private var cutoffOptions: [(value: Int?, label: LocalizedStringKey)] {
        [(nil, "None")] + Self.resolutionOptions.map { (Optional($0.value), $0.label) }
    }

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
                Toggle("Prefer HDR", isOn: $preferHdr).tint(Theme.apricot).listRowBackground(Theme.raised)
                Toggle("Require HDR", isOn: $requireHdr).tint(Theme.apricot).listRowBackground(Theme.raised)
            }
            Section {
                DisclosureGroup("Advanced") {
                    advancedRows
                }
            }
            .listRowBackground(Theme.raised)
            if let saveError {
                Section { Text(saveError).foregroundStyle(Theme.danger) }
                    .listRowBackground(Theme.raised)
            }
        }
        .scrollContentBackground(.hidden)
        .readableWidth()
        .background(Theme.base)
        .tint(Theme.apricot)
        .navigationTitle(Text(LocalizedStringKey(profile == nil ? "New profile" : "Edit profile")))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if saving {
                    ProgressView().tint(Theme.apricot)
                } else {
                    Button("Save") { Task { await save() } }.disabled(name.isEmpty).requiresConnection(model.isOffline)
                }
            }
        }
        .onAppear(perform: seed)
    }

    /// Everything past the five basics: preferences, limits, grab delay, trackers and custom formats.
    @ViewBuilder
    private var advancedRows: some View {
        OrderedMultiSelectRow(title: "Preferred sources", selected: $sources, options: QualityProfileSources.options)
        OrderedMultiSelectRow(title: "Preferred codecs", selected: $codecs, options: Self.codecOptions)
        OrderedMultiSelectRow(title: "Preferred languages", selected: $languages, options: Self.languageOptions)
        PickerRow(title: "Search title language", selection: $searchLanguage, options: searchLanguageOptions)
        NumberFieldRow("Min seeders", value: $minSeeders, range: 0 ... 100_000)
        LabeledTextFieldRow(title: "Max size (GB)", text: $maxSizeText, keyboard: .decimalPad)
        NumberFieldRow("Grab delay (minutes)", value: $grabDelayMinutes, range: 0 ... 43200)
        Toggle("Skip delay when cutoff is met", isOn: $bypassDelayIfCutoffMet)
            .tint(Theme.apricot)
        Text("The delay holds automatic grabs so a better release can show up. Manual grabs are never delayed. Held releases are listed under Queue in Activity, where you can grab one early.")
            .font(.footnote).foregroundStyle(Theme.muted)
        trackerRows
        Toggle("Prefer tracker over quality", isOn: $preferTracker)
            .tint(Theme.apricot)
        if !formats.isEmpty {
            Text("Custom formats").font(.footnote).foregroundStyle(Theme.muted)
        }
        ForEach(formats) { format in
            customFormatRow(format)
        }
    }

    /// The prioritized trackers as an ordered list: first is tried first.
    @ViewBuilder
    private var trackerRows: some View {
        Text("Prioritized trackers").font(.footnote).foregroundStyle(Theme.muted)
        ForEach(Array(trackers.enumerated()), id: \.offset) { index, tracker in
            HStack(spacing: 8) {
                Text(verbatim: tracker).foregroundStyle(Theme.text)
                Spacer()
                Button { trackers = OrderedListEdit.moved(trackers, index: index, by: -1) } label: {
                    Image(systemName: "chevron.up")
                }
                .disabled(index == 0).buttonStyle(.borderless)
                .accessibilityLabel(Text("Move up"))
                Button { trackers = OrderedListEdit.moved(trackers, index: index, by: 1) } label: {
                    Image(systemName: "chevron.down")
                }
                .disabled(index == trackers.count - 1).buttonStyle(.borderless)
                .accessibilityLabel(Text("Move down"))
                Button(role: .destructive) { trackers = OrderedListEdit.removed(trackers, at: index) } label: {
                    Image(systemName: "minus.circle")
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(Text("Remove"))
            }
        }
        HStack {
            TextField("Add a tracker", text: $newTracker)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .onSubmit(addTracker)
            Button("Add", action: addTracker)
                .disabled(newTracker.trimmingCharacters(in: .whitespaces).isEmpty)
                .buttonStyle(.borderless)
        }
    }

    /// Adds what was typed; a pasted comma-separated list becomes separate entries.
    private func addTracker() {
        trackers = OrderedListEdit.appendedAll(trackers, newTracker)
        newTracker = ""
    }

    private func customFormatRow(_ format: CustomFormatDTO) -> some View {
        let included = scores[format.id] != nil
        return HStack {
            Button {
                if included {
                    scores[format.id] = nil
                    stances[format.id] = nil
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
                Picker("Stance", selection: Binding(
                    get: { stances[format.id] ?? .neither },
                    set: { stances[format.id] = $0 }
                )) {
                    ForEach(FormatStance.allCases) { stance in
                        Text(stance.label).tag(stance)
                    }
                }
                .labelsHidden()
                .pickerStyle(.menu)
                .tint(Theme.apricot)
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
        sources = profile.preferredSources ?? []
        codecs = profile.preferredCodecs ?? []
        languages = profile.preferredLanguages ?? []
        searchLanguage = profile.preferredSearchLanguage
        trackers = profile.prioritizedTrackers ?? []
        preferTracker = profile.preferTrackerOverQuality ?? false
        maxSizeText = profile.maxSizeGb.map { String($0) } ?? ""
        minSeeders = profile.minSeeders ?? 0
        grabDelayMinutes = profile.grabDelayMinutes ?? 0
        bypassDelayIfCutoffMet = profile.bypassDelayIfCutoffMet ?? true
        requireHdr = profile.requireHdr ?? false
        preferHdr = profile.preferHdr ?? false
        var seededScores: [Int: Int] = [:]
        var seededStances: [Int: FormatStance] = [:]
        for assignment in profile.customFormats ?? [] {
            if let id = assignment.customFormatId {
                seededScores[id] = assignment.score ?? 0
                seededStances[id] = assignment.required == true
                    ? .required
                    : (assignment.forbidden == true ? .forbidden : .neither)
            }
        }
        scores = seededScores
        stances = seededStances
    }

    private func body_() -> SaveQualityProfileBody {
        let assignments = scores.map { id, score -> CustomFormatAssignmentBody in
            let stance = stances[id] ?? .neither
            return CustomFormatAssignmentBody(
                customFormatId: id,
                score: score,
                required: stance == .required,
                forbidden: stance == .forbidden
            )
        }
        return SaveQualityProfileBody(
            name: name.trimmingCharacters(in: .whitespaces),
            minResolution: minResolution,
            cutoffResolution: cutoffResolution,
            preferredSources: sources,
            preferredCodecs: codecs,
            preferredLanguages: languages,
            preferredSearchLanguage: searchLanguage,
            prioritizedTrackers: trackers,
            preferTrackerOverQuality: preferTracker,
            maxSizeGb: Double(maxSizeText),
            requireHdr: requireHdr,
            preferHdr: preferHdr,
            minSeeders: minSeeders ?? 0,
            grabDelayMinutes: grabDelayMinutes ?? 0,
            bypassDelayIfCutoffMet: bypassDelayIfCutoffMet,
            customFormats: assignments
        )
    }

    private func save() async {
        guard let client = model.api() else { return }
        // A tracker typed but not added yet still counts.
        addTracker()
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

#if DEBUG
    /// Opens the editor for the first real profile. Lives here because
    /// `QualityProfileEditorView` is file-private, and `simctl` cannot tap its way
    /// in from the list.
    struct DebugFirstQualityProfile: View {
        @Environment(AppModel.self) private var model

        @State private var profile: QualityProfile?
        @State private var formats: [CustomFormatDTO] = []
        @State private var failed = false

        var body: some View {
            Group {
                if let profile {
                    QualityProfileEditorView(profile: profile, formats: formats)
                } else if failed {
                    ContentUnavailableView("No profiles", systemImage: "slider.horizontal.3")
                        .rawkoonLivingSymbol(.error)
                } else {
                    ProgressView().tint(Theme.apricot)
                }
            }
            .task {
                guard let client = model.api() else {
                    failed = true
                    return
                }
                do {
                    formats = await (try? client.customFormats().customFormats) ?? []
                    profile = try await client.qualityProfiles().profiles.first
                    if profile == nil {
                        failed = true
                    }
                } catch {
                    failed = true
                }
            }
        }
    }
#endif
