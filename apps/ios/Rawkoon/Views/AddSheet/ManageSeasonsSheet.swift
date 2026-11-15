import RawkoonKit
import SwiftUI

/// Admin: change which seasons of a show in the library are monitored, and whether new seasons are.
struct ManageSeasonsSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let libraryId: Int
    let seasons: [SeasonInfo]
    let onSaved: () -> Void

    @State private var draft: SeasonDraft
    @State private var saving = false
    @State private var error: String?
    private let initial: SeasonDraft

    init(libraryId: Int, seasons: [SeasonInfo], current: SeasonDraft, onSaved: @escaping () -> Void) {
        self.libraryId = libraryId
        self.seasons = seasons
        self.onSaved = onSaved
        initial = current
        _draft = State(initialValue: current)
    }

    var body: some View {
        NavigationStack {
            Form {
                SeasonSection(seasons: seasons, draft: $draft)
                    .listRowBackground(Theme.raised)
                if let error {
                    Text(error).font(.footnote).foregroundStyle(Theme.terracotta)
                        .listRowBackground(Color.clear)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.base)
            .navigationTitle("Manage seasons")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await save() }
                    } label: {
                        if saving {
                            ProgressView()
                        } else {
                            Text("Save")
                        }
                    }
                    .disabled(saving || draft == initial || !draft.isValid)
                    .requiresConnection(model.isOffline)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationBackground(Theme.base)
    }

    private func save() async {
        guard let client = model.api() else { return }
        saving = true
        error = nil
        defer { saving = false }
        do {
            try await client.setMonitoredSeasons(id: libraryId, choice: draft.choice)
            onSaved()
            dismiss()
        } catch {
            self.error = String(localized: "Couldn't update the seasons.")
        }
    }
}
