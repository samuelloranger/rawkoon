import SwiftUI

/// System > AI usage: spend and call stats for a period, and the call-history drill-down.
struct AiUsageView: View {
    @Environment(AppModel.self) private var model

    @State private var period: AiStatsPeriod = .month
    @State private var stats: AiStatsResponse?
    @State private var statsLoading = true
    @State private var statsError: String?
    /// Bumped per load so an older response for the same period cannot overwrite a newer one.
    @State private var statsGeneration = 0

    var body: some View {
        Group {
            if model.isAdmin {
                form
            } else {
                ContentUnavailableView("Admin only", systemImage: "lock")
                    .rawkoonLivingSymbol(.empty)
            }
        }
        .navigationTitle("AI usage")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var form: some View {
        Form {
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
        .settingsScreenStyle()
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
                    Text(statsError).foregroundStyle(Theme.danger)
                    Button("Retry") { Task { await loadStats() } }.tint(Theme.apricot)
                }
            }
            .listRowBackground(Theme.raised)
        } else if let stats {
            AiStatsSections(stats: stats)
        }
    }

    private func loadStats() async {
        guard let client = model.api() else { statsLoading = false; return }
        statsGeneration += 1
        let token = statsGeneration
        statsLoading = true; statsError = nil
        do {
            let result = try await client.aiStats(days: period.rawValue)
            // A cancelled request surfaces as a transport error, so check staleness instead of the error type.
            guard !Task.isCancelled, token == statsGeneration else { return }
            stats = result
            statsError = nil
        } catch {
            guard !Task.isCancelled, token == statsGeneration else { return }
            statsError = settingsErrorMessage(error)
        }
        statsLoading = false
    }
}
