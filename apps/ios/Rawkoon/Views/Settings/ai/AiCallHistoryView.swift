import RawkoonKit
import SwiftUI

/// Paginated AI call history with feature and status filters. Loads the next
/// page as the last row scrolls into view.
struct AiCallHistoryView: View {
    @Environment(AppModel.self) private var model

    private static let pageSize = 20

    @State private var calls: [AiCallEntry] = []
    @State private var total = 0
    @State private var page = 0
    @State private var loading = false
    @State private var loadError: String?
    @State private var feature = ""
    @State private var status = ""
    /// Bumped on every reload so a response for an old filter state is dropped.
    @State private var generation = 0

    /// Seeds the list for the screenshot harness, which has no server to load from.
    private let preview: AiCallsResponse?

    init(preview: AiCallsResponse? = nil) {
        self.preview = preview
    }

    var body: some View {
        List {
            Section {
                PickerRow(title: "Feature", selection: $feature, options: featureOptions)
                PickerRow(title: "Status", selection: $status, options: statusOptions)
            }
            Section {
                if let loadError {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(loadError).foregroundStyle(Theme.terracotta)
                        Button("Retry") { Task { await reload() } }.tint(Theme.apricot)
                    }
                }
                ForEach(calls) { call in
                    NavigationLink {
                        AiCallDetailView(call: call)
                    } label: {
                        AiCallRow(call: call)
                    }
                    .onAppear {
                        if call.id == calls.last?.id {
                            Task { await loadMore() }
                        }
                    }
                }
                if loading {
                    HStack {
                        Spacer()
                        ProgressView().tint(Theme.apricot)
                        Spacer()
                    }
                } else if calls.isEmpty, loadError == nil {
                    Text("No calls match these filters.")
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)
                        .frame(maxWidth: .infinity, alignment: .center)
                }
            } footer: {
                if total > 0 {
                    Text("\(calls.count) of \(total)")
                }
            }
            .listRowBackground(Theme.raised)
        }
        .scrollContentBackground(.hidden)
        .readableWidth()
        .background(Theme.base)
        .tint(Theme.apricot)
        .navigationTitle("Call history")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: "\(feature)|\(status)") { await reload() }
    }

    private var featureOptions: [(value: String, label: LocalizedStringKey)] {
        [("", "All features")] + AiFeature.allCases.map { ($0.rawValue, $0.title) }
    }

    private var statusOptions: [(value: String, label: LocalizedStringKey)] {
        [("", "All statuses")] + AiCallStatus.allCases.map { ($0.rawValue, $0.title) }
    }

    private func reload() async {
        generation += 1
        calls = []
        total = 0
        page = 0
        loadError = nil
        loading = false
        await loadMore()
    }

    private func loadMore() async {
        guard !loading, page == 0 || calls.count < total else { return }
        if let preview {
            calls = preview.calls
            total = preview.total
            page = 1
            return
        }
        guard let client = model.api() else { return }
        let token = generation
        loading = true; loadError = nil
        let requested = page + 1
        do {
            let response = try await client.aiCalls(
                page: requested, pageSize: Self.pageSize,
                feature: feature.isEmpty ? nil : feature, status: status.isEmpty ? nil : status
            )
            guard token == generation, !Task.isCancelled else { return }
            calls += response.calls
            total = response.total
            page = requested
        } catch {
            guard token == generation, !Task.isCancelled else { return }
            loadError = settingsErrorMessage(error)
        }
        loading = false
    }
}

/// Coloured capsule naming a call's outcome.
struct AiStatusCapsule: View {
    let status: String

    private var known: AiCallStatus? {
        AiCallStatus(rawValue: status)
    }

    private var tint: Color {
        switch known {
        case .ok: Theme.seed
        case .invalidPick: Theme.apricot
        case .rateLimited: Theme.importing
        case .error: Theme.terracotta
        case .budgetSkipped, nil: Theme.muted
        }
    }

    var body: some View {
        Group {
            if let known {
                Text(known.title)
            } else {
                Text(verbatim: status)
            }
        }
        .font(.caption2.weight(.semibold))
        .foregroundStyle(tint)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(tint.opacity(0.15), in: Capsule())
    }
}

enum AiCallPresentation {
    static func featureName(_ raw: String) -> Text {
        if let feature = AiFeature(rawValue: raw) {
            return Text(feature.title)
        }
        return Text(verbatim: raw)
    }

    static func timeText(_ call: AiCallEntry) -> String {
        call.date?.formatted(.dateTime.month(.abbreviated).day().hour().minute()) ?? call.createdAt
    }

    static func tokensText(_ call: AiCallEntry) -> String {
        "\(AiUsage.tokens(call.inputTokens)) / \(AiUsage.tokens(call.outputTokens))"
    }
}

/// One call: feature and status on top, the title across the full width, then a
/// single quiet footer with time, tokens, duration and cost.
struct AiCallRow: View {
    let call: AiCallEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                AiCallPresentation.featureName(call.feature)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.apricotSoft)
                Spacer(minLength: 8)
                AiStatusCapsule(status: call.status)
            }
            if let title = call.targetTitle {
                Text(verbatim: title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.textStrong)
                    .lineLimit(2)
            }
            Text(verbatim: footer)
                .font(.caption)
                .foregroundStyle(Theme.muted)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .padding(.vertical, 3)
    }

    private var footer: String {
        var parts = [AiCallPresentation.timeText(call)]
        if call.inputTokens != nil || call.outputTokens != nil {
            parts.append(AiCallPresentation.tokensText(call))
        }
        if call.durationMs > 0 {
            parts.append(AiUsage.milliseconds(call.durationMs))
        }
        if let cost = call.estimatedCost {
            parts.append(AiUsage.cost(cost))
        }
        return parts.joined(separator: " \u{00B7} ")
    }
}

/// Everything recorded for one call: the reasoning, any error, the classic pick
/// it was compared with, and the model and trigger.
struct AiCallDetailView: View {
    let call: AiCallEntry

    var body: some View {
        List {
            Section {
                HStack {
                    AiCallPresentation.featureName(call.feature)
                        .font(.headline)
                        .foregroundStyle(Theme.textStrong)
                    Spacer()
                    AiStatusCapsule(status: call.status)
                }
                if let title = call.targetTitle {
                    row("Title", title)
                }
                row("Time", AiCallPresentation.timeText(call))
                row("Model", call.model)
                LabeledContent("Trigger") {
                    Text(AiTrigger.title(call.trigger))
                }
                .foregroundStyle(Theme.text)
                row("Duration", AiUsage.milliseconds(call.durationMs))
                row("Tokens in / out", AiCallPresentation.tokensText(call))
                row("Estimated cost", AiUsage.cost(call.estimatedCost))
            }
            .listRowBackground(Theme.raised)
            if call.pickedTitle != nil || call.classicTitle != nil {
                Section {
                    if let picked = call.pickedTitle {
                        row("AI pick", picked)
                    }
                    if let classic = call.classicTitle {
                        row("Classic pick", classic)
                    }
                    if let agreed = call.agreedWithClassic {
                        LabeledContent("Agreed with classic") {
                            Text(agreed ? "Yes" : "No")
                        }
                        .foregroundStyle(Theme.text)
                    }
                }
                .listRowBackground(Theme.raised)
            }
            if let reasoning = call.reasoning, !reasoning.isEmpty {
                Section {
                    Text(verbatim: reasoning).foregroundStyle(Theme.text)
                } header: {
                    Text("Reasoning")
                }
                .listRowBackground(Theme.raised)
            }
            if let error = call.error, !error.isEmpty {
                Section {
                    Text(verbatim: error).foregroundStyle(Theme.terracotta)
                } header: {
                    Text("Error")
                }
                .listRowBackground(Theme.raised)
            }
        }
        .scrollContentBackground(.hidden)
        .readableWidth()
        .background(Theme.base)
        .tint(Theme.apricot)
        .navigationTitle("Call details")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func row(_ label: LocalizedStringKey, _ value: String) -> some View {
        LabeledContent(label, value: value).foregroundStyle(Theme.text)
    }
}
