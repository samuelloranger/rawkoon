import SwiftUI

/// Indexers (admin): one screen for the indexer manager. A Prowlarr | Jackett switch picks the
/// manager and shows its connection and RSS indexer picker. Choosing a connected manager makes it
/// the active one; one that isn't enabled yet is shown with a note and becomes active once its
/// connection is saved and enabled. The indexers the active manager serves are listed below.
struct IndexersSettingsView: View {
    @Environment(AppModel.self) private var model

    /// The manager the server searches through; nil until one is chosen.
    @State private var active: IndexerManagerKind?
    /// The manager whose connection is on screen.
    @State private var viewing: IndexerManagerKind = .prowlarr
    @State private var phase: Phase = .loading
    @State private var switching = false
    @State private var notice: String?

    private enum Phase: Equatable {
        case loading, loaded, failed(String)
    }

    var body: some View {
        Group {
            if model.isAdmin {
                content
            } else {
                ContentUnavailableView("Admin only", systemImage: "lock")
                    .rawkoonLivingSymbol(.empty)
            }
        }
        .navigationTitle("Indexers")
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadActiveManager() }
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .loading:
            ProgressView().tint(Theme.apricot)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Theme.base)
        case let .failed(message):
            VStack(spacing: 12) {
                Text(message).foregroundStyle(Theme.danger)
                Button("Retry") { Task { await loadActiveManager() } }.tint(Theme.apricot)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.base)
        case .loaded:
            VStack(spacing: 0) {
                switcher
                // Keyed by manager, so switching loads the other one's connection fresh.
                IndexerManagerIntegrationView(kind: viewing, onSaved: { enabled in
                    Task { await connectionSaved(enabled: enabled) }
                }, extraSections: {
                    if viewing == active {
                        IndexerListSection().id(active)
                    }
                })
                .id(viewing)
            }
            .background(Theme.base)
        }
    }

    private var switcher: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Picker("Indexer manager", selection: pickerBinding) {
                    ForEach(IndexerManagerKind.allCases, id: \.self) { kind in
                        Text(kind.title).tag(kind)
                    }
                }
                .pickerStyle(.segmented)
                .disabled(switching)
                if switching {
                    ProgressView().tint(Theme.apricot)
                }
            }
            Group {
                if let active {
                    let name = String(localized: active.localizedName)
                    Text("Active manager: \(name)")
                } else {
                    Text("None selected")
                }
            }
            .font(.footnote)
            .foregroundStyle(Theme.muted)
            if let notice {
                Text(verbatim: notice).font(.footnote).foregroundStyle(Theme.apricot)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    private var pickerBinding: Binding<IndexerManagerKind> {
        Binding(get: { viewing }, set: { newKind in Task { await choose(newKind) } })
    }

    /// Switching to a connected manager makes it active before the screen changes; one that isn't
    /// enabled yet is shown so it can be set up, and is not made active.
    private func choose(_ newKind: IndexerManagerKind) async {
        guard newKind != viewing, !switching, let client = model.api() else { return }
        notice = nil
        if newKind == active {
            viewing = newKind
            return
        }
        switching = true
        defer { switching = false }
        let enabled = await (try? client.indexerManager(newKind.path).integration.enabled) ?? false
        guard enabled else {
            viewing = newKind
            let name = String(localized: newKind.localizedName)
            notice = String(localized: "\(name) isn't enabled yet. Save and enable its connection to make it the active manager.")
            return
        }
        do {
            try await client.setActiveIndexerManager(newKind.path)
            active = newKind
            viewing = newKind
        } catch {
            model.toast(settingsErrorMessage(error), style: .error)
        }
    }

    /// Saving an enabled connection for a manager that isn't active yet activates it.
    private func connectionSaved(enabled: Bool) async {
        guard enabled, viewing != active, let client = model.api() else { return }
        do {
            try await client.setActiveIndexerManager(viewing.path)
            active = viewing
            notice = nil
        } catch {
            model.toast(settingsErrorMessage(error), style: .error)
        }
    }

    private func loadActiveManager() async {
        guard let client = model.api() else {
            phase = .failed(String(localized: "Not signed in."))
            return
        }
        phase = .loading
        do {
            let value = try await client.postProcessingSettings().settings.activeIndexerManager
            active = IndexerManagerKind.allCases.first { $0.path == value }
            viewing = active ?? .prowlarr
            phase = .loaded
        } catch {
            phase = .failed(settingsErrorMessage(error))
        }
    }
}

/// The indexers the active manager serves, read-only, as Form sections.
struct IndexerListSection: View {
    @Environment(AppModel.self) private var model

    @State private var indexers: [Indexer] = []
    @State private var loading = true
    @State private var errorMessage: String?

    var body: some View {
        Section {
            if loading, indexers.isEmpty {
                HStack {
                    Spacer()
                    ProgressView().tint(Theme.apricot)
                    Spacer()
                }
            } else if let errorMessage, indexers.isEmpty {
                Text(errorMessage).foregroundStyle(Theme.danger)
            } else if indexers.isEmpty {
                Text("No indexers are configured yet.").foregroundStyle(Theme.muted)
            }
            ForEach(indexers) { indexer in
                row(indexer)
            }
        } header: {
            Text("Indexers")
        }
        .listRowBackground(Theme.raised)
        .task { await load() }
    }

    private func row(_ indexer: Indexer) -> some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 6) {
                Text(verbatim: indexer.name)
                    .foregroundStyle(Theme.textStrong)
                    .lineLimit(2)
                HStack(spacing: 6) {
                    if let protocolType = indexer.protocolType, !protocolType.isEmpty {
                        chip(protocolType)
                    }
                    if let privacy = indexer.privacy, !privacy.isEmpty {
                        chip(privacy)
                    }
                }
            }
            Spacer(minLength: 8)
            StatusBadge(
                text: indexer.enabled ? "Enabled" : "Disabled",
                tint: indexer.enabled ? Theme.seed : Theme.muted
            )
        }
        .padding(.vertical, 2)
    }

    private func chip(_ text: String) -> some View {
        Text(verbatim: text.uppercased())
            .font(.system(.caption2, design: .monospaced))
            .foregroundStyle(Theme.faint)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Theme.inset, in: Capsule())
    }

    /// Always fetched fresh: a saved list may belong to the manager that was active before.
    private func load() async {
        guard let client = model.api() else {
            loading = false
            return
        }
        do {
            indexers = try await client.indexers().indexers
            errorMessage = nil
        } catch {
            errorMessage = settingsErrorMessage(error)
        }
        loading = false
    }
}
