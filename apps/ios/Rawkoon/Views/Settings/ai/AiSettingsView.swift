import SwiftUI

/// Admin "AI" settings: provider config, usage stats and a call-history drill-down.
struct AiSettingsView: View {
    @Environment(AppModel.self) private var model

    @State private var config = AiProviderConfigModel()
    @State private var period: AiStatsPeriod = .month
    @State private var stats: AiStatsResponse?
    @State private var statsLoading = true
    @State private var statsError: String?

    var body: some View {
        Group {
            if !model.isAdmin {
                ContentUnavailableView("Admin only", systemImage: "lock")
            } else {
                form
            }
        }
        .navigationTitle("AI")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var form: some View {
        Form {
            SettingsStateView(isLoading: config.loading, error: config.loadError, retry: { Task { await reloadConfig() } }) {
                AiProviderConfigSections(config: config, api: { model.api() })
            }
            usageSections
            Section {
                NavigationLink {
                    AiCallHistoryView()
                } label: {
                    Label("Call history", systemImage: "clock.arrow.circlepath")
                }
            }
            .listRowBackground(Theme.raised)
        }
        .scrollContentBackground(.hidden)
        .readableWidth()
        .background(Theme.base)
        .tint(Theme.apricot)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if config.saving {
                    ProgressView().tint(Theme.apricot)
                } else {
                    Button("Save") { Task { await save() } }
                        .disabled(!config.isDirty)
                        .requiresConnection(model.isOffline)
                }
            }
        }
        .task { await reloadConfig() }
        .task(id: period) { await loadStats() }
    }

    @ViewBuilder
    private var usageSections: some View {
        Section {
            SegmentedRow(
                title: "Period", selection: $period,
                options: AiStatsPeriod.allCases.map { (value: $0, label: $0.title) }
            )
        } header: {
            Text("Usage")
        }
        if statsLoading, stats == nil {
            Section {
                HStack {
                    Spacer()
                    ProgressView().tint(Theme.apricot)
                    Spacer()
                }
            }
            .listRowBackground(Theme.raised)
        } else if let statsError {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text(statsError).foregroundStyle(Theme.terracotta)
                    Button("Retry") { Task { await loadStats() } }.tint(Theme.apricot)
                }
            }
            .listRowBackground(Theme.raised)
        } else if let stats {
            AiStatsSections(stats: stats)
        }
    }

    private func reloadConfig() async {
        await config.load(api: model.api())
    }

    private func save() async {
        await config.save(api: model.api())
        // Prices and budget drive today's tile and the cost figures.
        await loadStats()
    }

    private func loadStats() async {
        guard let client = model.api() else { statsLoading = false; return }
        statsLoading = true; statsError = nil
        do {
            stats = try await client.aiStats(days: period.rawValue)
        } catch is CancellationError {
            return
        } catch {
            statsError = settingsErrorMessage(error)
        }
        statsLoading = false
    }
}
