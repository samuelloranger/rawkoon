import SwiftUI

/// The rules editor inside the shelf editor (administrators only): the rule fields, save/clear,
/// seed, auto-join and a live preview. Rule writes hit the server at once, like title adds and
/// removes, so `onChanged` hands the editor the fresh shelf to merge.
struct ShelfRulesSections: View {
    @Environment(AppModel.self) private var model

    let shelfId: Int
    let onChanged: (ShelfDetail) -> Void

    @State private var draft: ShelfRulesDraft
    @State private var saved: ShelfRules?
    @State private var autoJoin: Bool
    @State private var names: [String: String]
    @State private var genres: [Genre] = []
    @State private var busy = false
    @State private var confirmSeed = false
    @State private var networkText = ""
    @State private var certificationText = ""
    /// Bumped after every server write so the preview re-reads its pin states even when the rules are unchanged.
    @State private var reloadToken = 0

    init(detail: ShelfDetail, onChanged: @escaping (ShelfDetail) -> Void) {
        shelfId = detail.id
        self.onChanged = onChanged
        _draft = State(initialValue: ShelfRulesDraft(detail.rules))
        _saved = State(initialValue: detail.rules)
        _autoJoin = State(initialValue: detail.autoJoin ?? false)
        _names = State(initialValue: detail.ruleNames ?? [:])
    }

    private var rules: ShelfRules? {
        draft.rules
    }

    private var hasSavedRules: Bool {
        ShelfRulesDraft(saved).rules != nil
    }

    private var dirty: Bool {
        rules != ShelfRulesDraft(saved).rules
    }

    var body: some View {
        Group {
            typesSection
            genresSection
            lookupSection
            otherSection
            actionsSection
            ShelfRulesPreviewSection(shelfId: shelfId, rules: rules, reloadToken: reloadToken) {
                await refetch()
            }
        }
        .task { await loadGenres() }
        .confirmationDialog("Add the matching titles now?", isPresented: $confirmSeed, titleVisibility: .visible) {
            Button("Seed from rules") { Task { await seed() } }
        } message: {
            Text("Every title the saved rules select is added to this shelf. Titles you removed stay off.")
        }
    }

    // MARK: Fields

    private var typesSection: some View {
        Section {
            ForEach(["movie", "show"], id: \.self) { type in
                Toggle(type == "movie" ? "Movies" : "Shows", isOn: Binding(
                    get: { draft.types.contains(type) },
                    set: { isOn in
                        draft.types.removeAll { $0 == type }
                        if isOn {
                            draft.types.append(type)
                        }
                    }
                ))
                .tint(Theme.apricot)
            }
        } header: {
            Text("Rules")
        } footer: {
            Text(
                "Library titles matching every filled-in field join the shelf. Empty fields are ignored."
            )
        }
    }

    private var genresSection: some View {
        Section("Genres") {
            GenrePickerRow(title: "Any of", genres: genres, selection: $draft.genresAny)
            GenrePickerRow(title: "None of", genres: genres, selection: $draft.genresNone)
        }
    }

    private var lookupSection: some View {
        Section("Keywords and companies") {
            LookupChipsField(title: "Keywords (any of)", kind: "keywords", prefix: "keyword",
                             ids: $draft.keywordsAny, names: $names)
            LookupChipsField(title: "Keywords (none of)", kind: "keywords", prefix: "keyword",
                             ids: $draft.keywordsNone, names: $names)
            LookupChipsField(title: "Companies (any of)", kind: "companies", prefix: "company",
                             ids: $draft.companiesAny, names: $names)
        }
    }

    private var otherSection: some View {
        Section {
            TokenField(
                title: "Networks",
                prompt: "TMDB network id",
                text: $networkText,
                values: draft.networksAny.map(String.init)
            ) { text in
                if let id = Int(text), id > 0, !draft.networksAny.contains(id) {
                    draft.networksAny.append(id)
                }
            } onRemove: { text in
                draft.networksAny.removeAll { String($0) == text }
            }
            TokenField(
                title: "Certifications",
                prompt: "e.g. PG",
                text: $certificationText,
                values: draft.certifications
            ) { text in
                let value = String(text.prefix(12))
                if !value.isEmpty, !draft.certifications.contains(value) {
                    draft.certifications.append(value)
                }
            } onRemove: { text in
                draft.certifications.removeAll { $0 == text }
            }
            numberRow("Collection id", text: $draft.collection)
            numberRow("Year from", text: $draft.yearMin)
            numberRow("Year to", text: $draft.yearMax)
            numberRow("Minimum votes", text: $draft.votesMin)
            numberRow("Minimum rating", text: $draft.ratingMin, decimal: true)
        } header: {
            Text("Other filters")
        }
    }

    private func numberRow(_ title: LocalizedStringKey, text: Binding<String>, decimal: Bool = false) -> some View {
        HStack {
            Text(title)
            TextField("No filter", text: text)
                .keyboardType(decimal ? .decimalPad : .numberPad)
                .multilineTextAlignment(.trailing)
        }
    }

    private var actionsSection: some View {
        Section {
            Button("Save rules") { Task { await save(rules) } }
                .disabled(!dirty || busy)
            Button("Clear rules", role: .destructive) {
                draft = ShelfRulesDraft()
                if hasSavedRules {
                    Task { await save(nil) }
                }
            }
            .disabled(rules == nil && !hasSavedRules)
            Button("Seed from rules") { confirmSeed = true }
                .disabled(!hasSavedRules || dirty || busy)
            Toggle("Auto-join", isOn: Binding(get: { autoJoin }, set: { value in
                Task { await setAutoJoin(value) }
            }))
            .tint(Theme.apricot)
            .disabled((!hasSavedRules && !autoJoin) || busy)
        } footer: {
            if dirty, hasSavedRules {
                Text("Save the rules before seeding.")
            } else if hasSavedRules {
                Text("New library titles that match the rules join this shelf by themselves.")
            } else {
                Text("Save rules first: auto-join needs them.")
            }
        }
        .requiresConnection(model.isOffline)
    }

    // MARK: Server

    private func loadGenres() async {
        guard genres.isEmpty, let client = model.api() else { return }
        async let movies = try? client.genres(type: "movie")
        async let shows = try? client.genres(type: "tv")
        let all = await (movies ?? []) + (shows ?? [])
        genres = Dictionary(all.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first }).values
            .sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
    }

    /// Reads the shelf as the editor sees it, including titles removed from it.
    private func refetch() async {
        guard let client = model.api() else { return }
        if let fresh = try? await client.shelf(id: shelfId, includeExcluded: true) {
            onChanged(fresh)
        }
        reloadToken += 1
    }

    private func run(_ failure: String, _ work: (APIClient) async throws -> Void) async {
        guard let client = model.api() else { return }
        busy = true
        defer { busy = false }
        do {
            try await work(client)
        } catch let apiError as APIError {
            model.toast(apiError.userMessage(unauthorized: String(localized: "Sign in required.")), style: .error)
        } catch {
            model.toast(failure, style: .error)
        }
    }

    private func save(_ next: ShelfRules?) async {
        await run(String(localized: "Couldn't save the rules.")) { client in
            let updated = try await client.saveShelfRules(id: shelfId, rules: next)
            saved = updated.rules
            autoJoin = updated.autoJoin ?? false
            draft = ShelfRulesDraft(updated.rules)
            names.merge(updated.ruleNames ?? [:]) { _, server in server }
            await refetch()
            model.toast(String(localized: "Rules saved."), style: .success)
        }
    }

    private func setAutoJoin(_ value: Bool) async {
        await run(String(localized: "Couldn't change auto-join.")) { client in
            autoJoin = try await client.setShelfAutoJoin(id: shelfId, enabled: value).autoJoin ?? value
            await refetch()
        }
    }

    private func seed() async {
        await run(String(localized: "Couldn't add the titles.")) { client in
            // Count added = new total - old total, as the server reports only the shelf
            let before = try await client.shelf(id: shelfId).entryCount
            let updated = try await client.seedShelfFromRules(id: shelfId)
            let added = max(0, updated.entryCount - before)
            await refetch()
            model.toast(String(localized: "\(added) titles added"), style: .success)
        }
    }
}

// MARK: - Preview

/// What the unsaved rules would select, re-run half a second after the last edit.
private struct ShelfRulesPreviewSection: View {
    @Environment(AppModel.self) private var model

    let shelfId: Int
    let rules: ShelfRules?
    let reloadToken: Int
    let onPinned: () async -> Void

    @State private var preview: ShelfPreview?
    @State private var failed = false
    @State private var loading = false
    @State private var showAll = false

    private static let collapsedCount = 20

    private struct PreviewKey: Equatable {
        let rules: ShelfRules?
        let token: Int
    }

    var body: some View {
        Section {
            if rules == nil {
                Text("Fill in a rule to preview what it selects.").foregroundStyle(Theme.muted)
            } else if failed {
                Text("Couldn't preview these rules.").foregroundStyle(Theme.danger)
            } else if let preview {
                content(preview)
            } else {
                ProgressView()
            }
        } header: {
            HStack {
                Text("Preview")
                if loading, preview != nil {
                    ProgressView().controlSize(.mini)
                }
            }
        }
        .task(id: PreviewKey(rules: rules, token: reloadToken)) { await load() }
    }

    @ViewBuilder
    private func content(_ preview: ShelfPreview) -> some View {
        Text("\(preview.matches.count) matches").font(.footnote).foregroundStyle(Theme.muted)
        ForEach(showAll ? preview.matches : Array(preview.matches.prefix(Self.collapsedCount))) { item in
            PreviewRow(item: item)
        }
        if preview.matches.count > Self.collapsedCount, !showAll {
            Button("Show all \(preview.matches.count)") { showAll = true }
        }
        if !preview.excluded.isEmpty {
            Text("Excluded by rules").font(.footnote.weight(.semibold)).foregroundStyle(Theme.muted)
            ForEach(preview.excluded) { item in
                PreviewRow(item: item) {
                    Button("Pin in") { Task { await pin(item) } }
                        .buttonStyle(.bordered)
                        .disabled(item.inShelf)
                }
            }
        }
        if preview.truncated {
            Text("Showing the first results only.").font(.footnote).foregroundStyle(Theme.muted)
        }
    }

    private func load() async {
        failed = false
        guard let rules, let client = model.api() else {
            preview = nil
            return
        }
        // Debounce: a newer edit cancels this task before the request goes out
        do { try await Task.sleep(for: .milliseconds(500)) } catch { return }
        loading = true
        defer { loading = false }
        do {
            preview = try await client.previewShelfRules(id: shelfId, rules: rules)
            failed = false
        } catch is CancellationError {
            return
        } catch {
            if !Task.isCancelled {
                failed = true
            }
        }
    }

    private func pin(_ item: ShelfPreviewTitle) async {
        guard let client = model.api() else { return }
        do {
            try await client.addShelfEntry(shelfId: shelfId, tmdbId: item.tmdbId, type: item.type)
            await onPinned()
            model.toast(String(localized: "Title added."), style: .success)
        } catch {
            model.toast(String(localized: "Couldn't add the title."), style: .error)
        }
    }
}

private struct PreviewRow<Action: View>: View {
    @Environment(AppModel.self) private var model
    let item: ShelfPreviewTitle
    let action: Action

    // swiftformat:disable:next redundantMemberwiseInit
    init(item: ShelfPreviewTitle, @ViewBuilder action: () -> Action) {
        self.item = item
        self.action = action()
    }

    private var typeName: String {
        item.type == "movie" ? String(localized: "Movie") : String(localized: "Show")
    }

    var body: some View {
        HStack(spacing: 10) {
            CachedAsyncImage(
                url: model.absoluteURL(item.posterUrl), targetSize: CGSize(width: 60, height: 90)
            ) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                Theme.inset
            }
            .frame(width: 30, height: 45)
            .clipShape(RoundedRectangle(cornerRadius: 4))
            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: item.title).font(.subheadline).lineLimit(1)
                Text(verbatim: [item.year.map(String.init), typeName].compactMap(\.self).joined(separator: " · "))
                    .font(.caption2)
                    .foregroundStyle(Theme.muted)
                if item.inShelf || !item.reason.isEmpty {
                    FlowLayout(spacing: 4) {
                        if item.inShelf {
                            RuleChip(text: String(localized: "On this shelf"), highlighted: true)
                        }
                        ForEach(item.reason, id: \.self) { RuleChip(text: $0) }
                    }
                }
            }
            Spacer(minLength: 6)
            action
        }
    }
}

extension PreviewRow where Action == EmptyView {
    init(item: ShelfPreviewTitle) {
        self.init(item: item) { EmptyView() }
    }
}
