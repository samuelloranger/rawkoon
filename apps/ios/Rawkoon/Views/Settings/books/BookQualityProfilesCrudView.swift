import SwiftUI

/// Book quality profiles CRUD (admin). List + editor. `GET/POST/PATCH/DELETE
/// /api/book-quality-profiles`. Update is PATCH.
struct BookQualityProfilesCrudView: View {
    @Environment(AppModel.self) private var model

    @State private var profiles: [BookQualityProfile] = []
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
        .navigationTitle("Book quality profiles")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var list: some View {
        Form {
            SettingsStateView(isLoading: loading, error: loadError, retry: { Task { await load() } }) {
                if profiles.isEmpty {
                    Text("No profiles yet.").foregroundStyle(Theme.muted).listRowBackground(Theme.raised)
                }
                ForEach(profiles) { profile in
                    NavigationLink {
                        BookQualityProfileEditorView(profile: profile)
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(profile.name).foregroundStyle(Theme.text)
                            LocalizedStatus.text(profile.kind ?? "").font(.footnote).foregroundStyle(Theme.muted)
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
                NavigationLink { BookQualityProfileEditorView(profile: nil) } label: { Image(systemName: "plus") }
            }
        }
        .onAppear { Task { await load() } }
    }

    private func load() async {
        guard let client = model.api() else { loading = false; return }
        loading = true; loadError = nil
        do {
            let gen = loadGen
            let fetched = try await client.bookQualityProfiles().profiles
            if gen == loadGen {
                profiles = fetched
            }
        } catch { loadError = settingsErrorMessage(error) }
        loading = false
    }

    private func delete(_ profile: BookQualityProfile) async {
        guard let client = model.api(), !busyIds.contains(profile.id) else { return }
        busyIds.insert(profile.id)
        defer { busyIds.remove(profile.id) }
        loadGen &+= 1
        guard let idx = profiles.firstIndex(where: { $0.id == profile.id }) else { return }
        let removed = profiles[idx]
        profiles.remove(at: idx) // optimistic (single element)
        do {
            try await client.deleteBookQualityProfile(id: profile.id)
            model.toast(String(localized: "Profile deleted."), style: .success)
        } catch {
            if !profiles.contains(where: { $0.id == removed.id }) {
                profiles.insert(removed, at: min(idx, profiles.count)) // restore just this row
            }
            model.toast(settingsErrorMessage(error), style: .error)
        }
    }
}

private struct BookQualityProfileEditorView: View {
    let profile: BookQualityProfile?

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var kind = "both"
    @State private var allowedFormats: Set<String> = []
    @State private var cutoffFormat: String? = nil
    @State private var preferRetail = true
    @State private var maxSize: Int? = nil
    @State private var minSeeders: Int? = 0
    @State private var minAudioBitrate: Int? = nil
    @State private var languages: Set<String> = []
    @State private var trackersText = ""
    @State private var preferTracker = false

    @State private var saving = false
    @State private var saveError: String?

    private static let kindOptions: [(value: String, label: LocalizedStringKey)] = [
        ("ebook", "Ebook"), ("audiobook", "Audiobook"), ("both", "Both"),
    ]
    private static let ebookFormats = ["epub", "azw3", "mobi", "pdf", "cbz"]
    private static let audiobookFormats = ["m4b", "mp3", "flac", "ogg"]

    private var formatsForKind: [String] {
        switch kind {
        case "ebook": Self.ebookFormats
        case "audiobook": Self.audiobookFormats
        default: Self.ebookFormats + Self.audiobookFormats
        }
    }

    private var formatOptions: [(value: String, label: String)] {
        formatsForKind.map { (value: $0, label: $0.uppercased()) }
    }

    private var cutoffOptions: [(value: String?, label: String)] {
        [(nil, "None")] + Array(allowedFormats).sorted().map { (Optional($0), $0.uppercased()) }
    }

    private static let languageOptions: [(value: String, label: LocalizedStringKey)] = [
        ("en", "English"), ("fr", "French"), ("de", "German"), ("es", "Spanish"),
        ("it", "Italian"), ("ja", "Japanese"), ("pt", "Portuguese"),
    ]

    var body: some View {
        Form {
            Section {
                LabeledTextFieldRow(title: "Name", text: $name, autocaps: true)
                PickerRow(title: "Kind", selection: $kind, options: Self.kindOptions)
                MultiSelectRow(title: "Allowed formats", selected: $allowedFormats, options: formatOptions)
                PickerRow(title: "Cutoff format", selection: $cutoffFormat, options: cutoffOptions)
            }
            Section {
                Toggle("Prefer retail", isOn: $preferRetail).tint(Theme.apricot).listRowBackground(Theme.raised)
                NumberFieldRow("Min seeders", value: $minSeeders, range: 0 ... 100_000)
                NumberFieldRow("Max size (MB)", value: $maxSize, range: 0 ... 1_000_000, suffix: "MB")
                if kind != "ebook" {
                    NumberFieldRow("Min audio bitrate", value: $minAudioBitrate, range: 0 ... 100_000, suffix: "kbps")
                }
            }
            Section {
                MultiSelectRow(title: "Preferred languages", selected: $languages, options: Self.languageOptions)
                LabeledTextFieldRow(title: "Prioritized trackers", text: $trackersText, placeholder: "comma-separated")
                Toggle("Prefer tracker over quality", isOn: $preferTracker)
                    .tint(Theme.apricot).listRowBackground(Theme.raised)
            }
            if let saveError {
                Section { Text(saveError).foregroundStyle(Theme.terracotta) }.listRowBackground(Theme.raised)
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
                    Button("Save") { Task { await save() } }.disabled(name.isEmpty || allowedFormats.isEmpty)
                }
            }
        }
        .onChange(of: kind) { _, _ in pruneForKind() }
        .onAppear(perform: seed)
    }

    private func pruneForKind() {
        let valid = Set(formatsForKind)
        allowedFormats = allowedFormats.intersection(valid)
        if let cutoff = cutoffFormat, !allowedFormats.contains(cutoff) {
            cutoffFormat = nil
        }
    }

    private func seed() {
        guard let profile else { return }
        name = profile.name
        kind = profile.kind ?? "both"
        allowedFormats = Set(profile.allowedFormats ?? [])
        cutoffFormat = profile.cutoffFormat
        preferRetail = profile.preferRetail ?? true
        maxSize = profile.maxSizeMb
        minSeeders = profile.minSeeders ?? 0
        minAudioBitrate = profile.minAudioBitrate
        languages = Set(profile.preferredLanguages ?? [])
        trackersText = (profile.prioritizedTrackers ?? []).joined(separator: ", ")
        preferTracker = profile.preferTrackerOverQuality ?? false
    }

    private func body_() -> SaveBookQualityProfileBody {
        let trackers = trackersText.split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        return SaveBookQualityProfileBody(
            name: name.trimmingCharacters(in: .whitespaces),
            kind: kind,
            allowedFormats: Array(allowedFormats),
            cutoffFormat: cutoffFormat,
            preferRetail: preferRetail,
            maxSizeMb: maxSize,
            minSeeders: minSeeders ?? 0,
            minAudioBitrate: kind == "ebook" ? nil : minAudioBitrate,
            preferredLanguages: Array(languages),
            prioritizedTrackers: trackers,
            preferTrackerOverQuality: preferTracker
        )
    }

    private func save() async {
        guard let client = model.api() else { return }
        saving = true; saveError = nil
        do {
            if let profile {
                try await client.updateBookQualityProfile(id: profile.id, body_())
            } else {
                try await client.createBookQualityProfile(body_())
            }
            dismiss()
        } catch {
            saveError = settingsErrorMessage(error)
        }
        saving = false
    }
}
