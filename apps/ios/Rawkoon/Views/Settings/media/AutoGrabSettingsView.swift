import RawkoonKit
import SwiftUI

/// Adding & checking (admin): search on add, how often wanted titles are re-checked
/// (presets, with a custom cron behind Advanced), how often indexer RSS feeds are
/// read, and releases held by a grab delay.
/// `GET/PATCH /api/library/post-processing/settings`, `/api/downloads/pending-releases`.
/// Whether the pipeline is ready to grab is answered on System > Health.
struct AutoGrabSettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    private enum Schedule: Hashable {
        case preset(ReleaseCheckCron.Preset)
        case custom
    }

    @State private var loading = true
    @State private var loadError: String?
    @State private var saving = false
    @State private var saveError: String?

    @State private var searchOnAdd = true
    @State private var schedule: Schedule = .preset(.every6h)
    @State private var customCron = ""
    @State private var rssInterval = RssPollInterval.defaultMinutes
    @State private var activeIndexerManager: String?
    @State private var loaded: Saved?

    @State private var advancedOpen = false
    @State private var held: [PendingRelease]?
    @State private var heldFailed = false
    @State private var grabbingKey: String?
    @State private var confirmingDiscard = false

    private struct Saved: Equatable {
        var searchOnAdd: Bool
        var cron: String
        var rssInterval: Int
    }

    private var cronText: String {
        switch schedule {
        case let .preset(preset): preset.cron
        case .custom: customCron
        }
    }

    private var validation: ReleaseCheckCron.Validation {
        ReleaseCheckCron.validate(cronText)
    }

    private var effectiveCron: String? {
        if case let .ok(cron) = validation {
            cron
        } else {
            nil
        }
    }

    /// Only the schedule waits for Save; the toggle and the RSS interval save themselves.
    private var cronDirty: Bool {
        guard let loaded else { return false }
        let draft = effectiveCron ?? cronText.trimmingCharacters(in: .whitespacesAndNewlines)
        return draft != loaded.cron
    }

    private var canSave: Bool {
        cronDirty && effectiveCron != nil
    }

    private var cronLocale: CronLocale {
        AppLanguage.resolvedTitleCode == "fr" ? .fr : .en
    }

    var body: some View {
        Group {
            if !model.isAdmin {
                ContentUnavailableView("Admin only", systemImage: "lock")
                    .rawkoonLivingSymbol(.empty)
            } else {
                form
            }
        }
        .navigationTitle("Adding & checking")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var form: some View {
        Form {
            SettingsStateView(isLoading: loading, error: loadError, retry: { Task { await load() } }) {
                if confirmingDiscard {
                    discardSection
                }
                Section {
                    ToggleRow(
                        "Search when a title is added",
                        isOn: $searchOnAdd,
                        subtitle: "Look for a release and grab the best match right after you add a movie or show."
                    )
                } footer: {
                    Text(searchOnAdd
                        ? "Search starts as soon as a title is added."
                        : "A new title waits for the scheduled check, or a manual search.")
                }

                scheduleSection
                rssSection
                heldSection

                if let saveError {
                    Section { Text(saveError).foregroundStyle(Theme.terracotta) }
                        .listRowBackground(Theme.raised)
                }
            }
        }
        .settingsScreenStyle()
        .refreshable { await refreshLive() }
        .onChange(of: searchOnAdd) { _, value in
            if let loaded, value != loaded.searchOnAdd {
                Task { await saveToggle(value) }
            }
        }
        .onChange(of: rssInterval) { _, value in
            if let loaded, value != loaded.rssInterval {
                Task { await saveRssInterval(value) }
            }
        }
        // Hiding the system back button also disables the swipe, so an unsaved schedule can't vanish silently.
        .navigationBarBackButtonHidden(cronDirty)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                if cronDirty {
                    Button {
                        confirmingDiscard = true
                    } label: {
                        Label("Back", systemImage: "chevron.backward")
                    }
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                if saving {
                    ProgressView().tint(Theme.apricot)
                } else {
                    Button("Save") { Task { await save() } }
                        .disabled(!canSave)
                        .requiresConnection(model.isOffline)
                }
            }
        }
        .task {
            // Popping back from a fix link re-fires this; only the live data should refresh then.
            if loaded == nil {
                await load()
            } else {
                await refreshLive()
            }
        }
    }

    private var discardSection: some View {
        Section {
            Text("You have an unsaved schedule.").foregroundStyle(Theme.text)
            Button("Discard changes", role: .destructive) { dismiss() }
            Button("Keep editing") { confirmingDiscard = false }
        }
        .listRowBackground(Theme.raised)
    }

    // MARK: Schedule

    private var scheduleSection: some View {
        Section {
            ForEach(ReleaseCheckCron.Preset.allCases, id: \.self) { preset in
                scheduleRow(.preset(preset), title: presetTitle(preset))
            }
            DisclosureGroup("Advanced", isExpanded: $advancedOpen) {
                scheduleRow(
                    .custom,
                    title: "Custom\u{2026}",
                    subtitle: schedule == .custom ? customSubtitle : nil
                )
                if schedule == .custom {
                    LabeledTextFieldRow(
                        title: "Cron expression",
                        text: $customCron,
                        placeholder: "0 */4 * * *",
                        mono: true
                    )
                    .accessibilityIdentifier("autograb-cron-field")
                    customFeedback
                }
            }
        } header: {
            Text("Check for new releases")
        } footer: {
            VStack(alignment: .leading, spacing: 4) {
                Text("How often wanted movies and episodes are searched for a release.")
                if schedule == .custom {
                    Text("Five fields: minute, hour, day of month, month, day of week. Times follow the server's time zone.")
                }
            }
        }
        .listRowBackground(Theme.raised)
    }

    private func presetTitle(_ preset: ReleaseCheckCron.Preset) -> LocalizedStringKey {
        switch preset {
        case .hourly: "Every hour"
        case .every6h: "Every 6 hours"
        case .every12h: "Every 12 hours"
        case .daily: "Every 24 hours"
        }
    }

    private var customSubtitle: String? {
        guard case .ok = validation else { return nil }
        return String(localized: "Custom: \(ReleaseCheckCron.describe(cronText, locale: cronLocale))")
    }

    @ViewBuilder
    private var customFeedback: some View {
        Group {
            switch validation {
            case .ok:
                Text("Runs \(ReleaseCheckCron.describe(cronText, locale: cronLocale)).")
                    .foregroundStyle(Theme.muted)
            case .tooFrequent:
                Text("This runs too often. Release checks must be at least \(ReleaseCheckCron.minIntervalMinutes) minutes apart.")
                    .foregroundStyle(Theme.terracotta)
            case .neverRuns:
                Text("This schedule never runs (for example 31 February).")
                    .foregroundStyle(Theme.terracotta)
            case .invalid:
                Text("This is not a valid cron expression. Use five fields, for example 0 */4 * * *.")
                    .foregroundStyle(Theme.terracotta)
            }
        }
        .font(.footnote)
        .listRowBackground(Theme.raised)
        .accessibilityIdentifier("autograb-cron-feedback")
    }

    private func scheduleRow(_ value: Schedule, title: LocalizedStringKey, subtitle: String? = nil) -> some View {
        Button {
            if value == .custom, schedule != .custom {
                customCron = cronText
            }
            schedule = value
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).foregroundStyle(Theme.text)
                    if let subtitle {
                        Text(verbatim: subtitle).font(.footnote).foregroundStyle(Theme.muted)
                    }
                }
                Spacer()
                if schedule == value {
                    Image(systemName: "checkmark").foregroundStyle(Theme.apricot)
                }
            }
        }
        .listRowBackground(Theme.raised)
        .accessibilityAddTraits(schedule == value ? .isSelected : [])
    }

    // MARK: RSS

    private var rssSection: some View {
        Section {
            PickerRow(
                title: "Read every",
                selection: $rssInterval,
                options: RssPollInterval.options.map { minutes in
                    (value: minutes, label: rssIntervalLabel(minutes))
                }
            )
            .accessibilityIdentifier("autograb-rss-interval")
        } header: {
            Text("Check indexer RSS feeds")
        } footer: {
            VStack(alignment: .leading, spacing: 4) {
                Text("How often the feeds of the indexers picked under RSS Polling are read. A new release that matches a wanted title is grabbed at the next read.")
                if activeIndexerManager == "jackett" {
                    Text("Jackett keeps feed results for 35 minutes by default. Set its Cache TTL below this interval, for example 120 seconds.")
                }
            }
        }
    }

    private func rssIntervalLabel(_ minutes: Int) -> LocalizedStringKey {
        minutes == RssPollInterval.defaultMinutes
            ? "\(minutes) minutes (default)"
            : "\(minutes) minutes"
    }

    // MARK: Held releases

    private var heldSection: some View {
        Section {
            if let held {
                if held.isEmpty {
                    Text("Nothing is held. A quality profile with a grab delay holds releases here until the delay ends.")
                        .font(.subheadline).foregroundStyle(Theme.muted)
                        .listRowBackground(Theme.raised)
                }
                ForEach(held) { item in
                    heldRow(item)
                }
            } else if heldFailed {
                Text("Couldn't load held releases.").foregroundStyle(Theme.terracotta).listRowBackground(Theme.raised)
            } else {
                ProgressView().tint(Theme.apricot).listRowBackground(Theme.raised)
            }
        } header: {
            Text("Held releases")
        } footer: {
            Text("Set per quality profile under Grab delay. Manual grabs are never held.")
        }
    }

    private func heldRow(_ item: PendingRelease) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(verbatim: item.episodeCode.map { "\(item.mediaTitle) \u{00B7} \($0)" } ?? item.mediaTitle)
                .font(.headline).foregroundStyle(Theme.textStrong)
            Text(verbatim: item.releaseTitle)
                .font(.footnote).foregroundStyle(Theme.muted).lineLimit(2)
            if let date = item.grabAfterDate {
                Group {
                    if date > Date() {
                        Text("Grabs \(date.formatted(.relative(presentation: .named))) unless a better release appears.")
                    } else {
                        Text("Grabs shortly unless a better release appears.")
                    }
                }
                .font(.footnote).foregroundStyle(Theme.muted)
            }
            Button {
                Task { await grabNow(item) }
            } label: {
                if grabbingKey == item.targetKey {
                    ProgressView().tint(Theme.onAccent)
                } else {
                    Text("Grab now")
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.apricot)
            .foregroundStyle(Theme.onAccent)
            .disabled(grabbingKey != nil)
            .requiresConnection(model.isOffline)
            .padding(.top, 2)
        }
        .padding(.vertical, 4)
        .listRowBackground(Theme.raised)
    }

    // MARK: Loading

    private func load() async {
        guard let client = model.api() else {
            loading = false
            return
        }
        loading = true
        loadError = nil
        do {
            let settings = try await client.autoGrabSettings()
            searchOnAdd = settings.searchOnAdd ?? true
            let cron = settings.releaseCheckCron ?? ReleaseCheckCron.defaultCron
            if let preset = ReleaseCheckCron.preset(for: cron) {
                schedule = .preset(preset)
                customCron = cron
            } else {
                schedule = .custom
                customCron = cron
                advancedOpen = true
            }
            rssInterval = RssPollInterval.normalized(settings.rssPollIntervalMinutes)
            activeIndexerManager = settings.activeIndexerManager
            loaded = Saved(
                searchOnAdd: searchOnAdd,
                cron: ReleaseCheckCron.normalize(cron) ?? cron,
                rssInterval: rssInterval
            )
        } catch {
            if Task.isCancelled || error is CancellationError {
                return
            }
            loadError = settingsErrorMessage(error)
        }
        loading = false
        await refreshLive()
    }

    private func refreshLive() async {
        await refreshHeld()
    }

    private func refreshHeld() async {
        guard let client = model.api() else { return }
        do {
            held = try await client.pendingReleases()
            heldFailed = false
        } catch {
            heldFailed = held == nil
        }
    }

    private func save() async {
        guard let client = model.api(), let cron = effectiveCron else { return }
        saving = true
        saveError = nil
        do {
            try await client.updateAutoGrab(UpdateAutoGrabBody(releaseCheckCron: cron))
            loaded?.cron = cron
            confirmingDiscard = false
            if case .custom = schedule, let preset = ReleaseCheckCron.preset(for: cron) {
                schedule = .preset(preset)
            }
        } catch {
            saveError = settingsErrorMessage(error)
        }
        saving = false
    }

    private func saveToggle(_ value: Bool) async {
        guard let client = model.api() else { return }
        saveError = nil
        do {
            try await client.updateAutoGrab(UpdateAutoGrabBody(searchOnAdd: value))
            loaded?.searchOnAdd = value
        } catch {
            searchOnAdd = loaded?.searchOnAdd ?? !value
            saveError = settingsErrorMessage(error)
        }
    }

    private func saveRssInterval(_ value: Int) async {
        guard let client = model.api() else { return }
        saveError = nil
        do {
            try await client.updateAutoGrab(UpdateAutoGrabBody(rssPollIntervalMinutes: value))
            loaded?.rssInterval = value
        } catch {
            rssInterval = loaded?.rssInterval ?? RssPollInterval.defaultMinutes
            saveError = settingsErrorMessage(error)
        }
    }

    private func grabNow(_ item: PendingRelease) async {
        guard let client = model.api() else { return }
        grabbingKey = item.targetKey
        defer { grabbingKey = nil }
        do {
            let result = try await client.grabPendingNow(targetKey: item.targetKey)
            if result.grabbed {
                model.toast(String(localized: "Grabbing \(item.mediaTitle)"), style: .success)
            } else {
                model.toast(AutoGrabText.grabFailure(result.reason), style: .error)
            }
        } catch {
            model.toast(settingsErrorMessage(error), style: .error)
        }
        await refreshHeld()
    }
}
