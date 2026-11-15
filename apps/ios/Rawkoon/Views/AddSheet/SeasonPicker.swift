import RawkoonKit
import SwiftUI

/// The season section's body (mode control, strip, summary), shared by the add sheet, the request sheet,
/// the approval sheet and Manage seasons. Hosts wrap it in a `Section` and add `NewSeasonsToggle`.
struct SeasonPicker: View {
    let seasons: [SeasonInfo]
    @Binding var mode: SeasonMode
    @Binding var picked: Set<Int>
    let monitorNew: Bool

    private var choice: SeasonChoice {
        SeasonChoice(mode: mode, picked: Array(picked), monitorNew: monitorNew)
    }

    private var modeBinding: Binding<SeasonMode> {
        Binding(
            get: { mode },
            set: { next in
                // Entering Pick starts from what the previous mode would have grabbed.
                if next == .pick, mode != .pick {
                    picked = SeasonPlan.monitored(seasons, choice: choice, today: SeasonPlan.today())
                }
                mode = next
            }
        )
    }

    var body: some View {
        Picker("Seasons", selection: modeBinding) {
            Text("All").tag(SeasonMode.all)
            Text("Future").tag(SeasonMode.future)
            Text("Latest").tag(SeasonMode.latest)
            Text("Pick").tag(SeasonMode.pick)
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .listRowSeparator(.hidden)

        if seasons.isEmpty {
            Text("Season details aren't available yet.")
                .font(.footnote)
                .foregroundStyle(Theme.muted)
        } else {
            SeasonStrip(
                seasons: seasons,
                choice: choice,
                onToggle: mode == .pick ? { number in
                    if picked.contains(number) {
                        picked.remove(number)
                    } else {
                        picked.insert(number)
                    }
                } : nil
            )
            .listRowSeparator(.hidden)
            Text(SeasonSummaryText.sentence(SeasonPlan.summary(seasons, choice: choice, today: SeasonPlan.today())))
                .font(.footnote)
                .foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// "New seasons as they air"; Future mode forces it on.
struct NewSeasonsToggle: View {
    let mode: SeasonMode
    @Binding var isOn: Bool

    var body: some View {
        Toggle("New seasons as they air", isOn: mode == .future ? .constant(true) : $isOn)
            .disabled(mode == .future)
            .tint(Theme.apricot)
    }
}

/// Mode, picks and the new-seasons switch as one editable state, seeded from a `SeasonChoice` or the server defaults.
struct SeasonDraft: Equatable {
    var mode: SeasonMode
    var picked: Set<Int>
    var monitorNew: Bool

    var choice: SeasonChoice {
        SeasonChoice(mode: mode, picked: Array(picked), monitorNew: monitorNew)
    }

    /// A pick with nothing selected cannot be sent (the server rejects an empty list).
    var isValid: Bool {
        mode != .pick || !picked.isEmpty
    }

    init(mode: SeasonMode, picked: Set<Int> = [], monitorNew: Bool) {
        self.mode = mode
        self.picked = picked
        self.monitorNew = monitorNew
    }

    init(_ choice: SeasonChoice) {
        self.init(mode: choice.mode, picked: Set(choice.picked), monitorNew: choice.monitorNew)
    }

    /// A request's saved choice; no mode means every season.
    init(requestMode: String?, seasons: [Int]?) {
        let mode = requestMode.flatMap(SeasonMode.init(rawValue:)) ?? .all
        self.init(mode: mode, picked: Set(seasons ?? []), monitorNew: true)
    }
}

/// The seasons section on its own: approval and Manage seasons.
struct SeasonSection: View {
    let seasons: [SeasonInfo]
    @Binding var draft: SeasonDraft

    var body: some View {
        Section("Seasons") {
            SeasonPicker(seasons: seasons, mode: $draft.mode, picked: $draft.picked, monitorNew: draft.monitorNew)
        }
        Section {
            NewSeasonsToggle(mode: draft.mode, isOn: $draft.monitorNew)
        }
    }
}
