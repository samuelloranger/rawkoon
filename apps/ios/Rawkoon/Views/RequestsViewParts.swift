import RawkoonKit
import SwiftUI

/// A quality profile choice for the approve dialog — unifies `QualityProfile`
/// (movie/show) and `BookQualityProfile` (book) behind the id/name the picker needs.
struct ApprovalProfileOption: Identifiable {
    let id: Int
    let name: String
    let detail: String?
}

/// Approve flow's profile picker. A sheet, not an alert/action-sheet: the list
/// can be long and each row carries a resolution/size detail line.
struct ProfilePickerSheet: View {
    let options: [ApprovalProfileOption]
    /// A show request's seasons; empty hides the season section.
    var seasons: [SeasonInfo] = []
    let onSelect: (ApprovalProfileOption, SeasonChoice?) -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var draft: SeasonDraft
    private let initialDraft: SeasonDraft

    init(
        options: [ApprovalProfileOption], seasons: [SeasonInfo] = [], requested: SeasonDraft = SeasonDraft(mode: .all, monitorNew: true),
        onSelect: @escaping (ApprovalProfileOption, SeasonChoice?) -> Void
    ) {
        self.options = options
        self.seasons = seasons
        self.onSelect = onSelect
        initialDraft = requested
        _draft = State(initialValue: requested)
    }

    var body: some View {
        NavigationStack {
            List {
                if !seasons.isEmpty {
                    SeasonSection(seasons: seasons, draft: $draft)
                        .listRowBackground(Theme.raised)
                }
                ForEach(options) { option in
                    Button {
                        // Untouched keeps the requester's own choice on the server.
                        onSelect(option, draft == initialDraft ? nil : draft.choice)
                        dismiss()
                    } label: {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(option.name)
                                .font(.display(16))
                                .foregroundStyle(Theme.textStrong)
                            if let detail = option.detail {
                                Text(detail)
                                    .font(.system(.caption, design: .monospaced))
                                    .foregroundStyle(Theme.muted)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .requiresConnection(model.isOffline)
                    .disabled(!draft.isValid)
                    .listRowBackground(Theme.raised)
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .readableWidth()
            .background(Theme.base)
            .navigationTitle("Choose a quality profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .presentationDetents(seasons.isEmpty ? [.medium, .large] : [.large])
        .presentationBackground(Theme.base)
    }
}

/// Which removal a request row offers: the requester's own pending or denied
/// request, or anyone's for an admin. Approved and available requests stay.
nonisolated enum RequestDeleteAction: Equatable {
    case withdraw, dismiss, delete

    static func action(status: String, requesterId: String?, userId: String?, isAdmin: Bool) -> Self? {
        guard status == "pending" || status == "denied" else { return nil }
        if let userId, requesterId == userId {
            return status == "pending" ? .withdraw : .dismiss
        }
        return isAdmin ? .delete : nil
    }

    var label: LocalizedStringKey {
        switch self {
        case .withdraw: "Withdraw"
        case .dismiss: "Clear"
        case .delete: "Delete"
        }
    }
}

/// What a request row's trailing slot shows; mirrors the slot's branch order.
nonisolated enum RequestRowFace: Equatable {
    case busy, moderate
    case status(String)

    static func face(busy: Bool, canModerate: Bool, status: String) -> Self {
        if busy {
            return .busy
        }
        return canModerate ? .moderate : .status(status)
    }
}
