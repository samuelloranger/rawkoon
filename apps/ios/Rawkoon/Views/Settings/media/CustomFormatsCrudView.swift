import RawkoonKit
import SwiftUI

/// Custom formats CRUD (admin) with a condition builder. `GET/POST/PUT/DELETE
/// /api/custom-formats`. Condition type→operator rules come from RawkoonKit.
struct CustomFormatsCrudView: View {
    @Environment(AppModel.self) private var model

    @State private var formats: [CustomFormatDTO] = []
    @State private var loading = true
    @State private var loadError: String?
    @State private var busyIds: Set<Int> = []

    var body: some View {
        Group {
            if !model.isAdmin {
                ContentUnavailableView("Admin only", systemImage: "lock")
            } else {
                list
            }
        }
        .navigationTitle("Custom formats")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var list: some View {
        Form {
            SettingsStateView(isLoading: loading, error: loadError, retry: { Task { await load() } }) {
                if formats.isEmpty {
                    Text("No custom formats yet.").foregroundStyle(Theme.muted)
                        .listRowBackground(Theme.raised)
                }
                ForEach(formats) { format in
                    NavigationLink {
                        CustomFormatEditorView(format: format)
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(format.name).foregroundStyle(Theme.text)
                            Text("\(format.conditions?.count ?? 0) conditions")
                                .font(.footnote).foregroundStyle(Theme.muted)
                        }
                    }
                    .listRowBackground(Theme.raised)
                    .swipeActions {
                        Button("Delete", role: .destructive) { Task { await delete(format) } }
                            .disabled(busyIds.contains(format.id))
                    }
                    .overlay(alignment: .trailing) {
                        if busyIds.contains(format.id) {
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
                NavigationLink { CustomFormatEditorView(format: nil) } label: { Image(systemName: "plus") }
            }
        }
        .onAppear { Task { await load() } }
    }

    private func load() async {
        guard let client = model.api() else { loading = false; return }
        loading = true; loadError = nil
        do { formats = try await client.customFormats().customFormats }
        catch { loadError = settingsErrorMessage(error) }
        loading = false
    }

    private func delete(_ format: CustomFormatDTO) async {
        guard let client = model.api(), !busyIds.contains(format.id) else { return }
        busyIds.insert(format.id)
        let removed = formats
        formats.removeAll { $0.id == format.id } // optimistic
        do {
            try await client.deleteCustomFormat(id: format.id)
            model.toast("Custom format deleted.", style: .success)
        } catch {
            formats = removed // restore on failure
            model.toast(settingsErrorMessage(error), style: .error)
        }
        busyIds.remove(format.id)
    }
}

private struct EditableCondition: Identifiable {
    let id = UUID()
    var type: String
    var op: String
    var value: String
    var negate: Bool
}

private struct CustomFormatEditorView: View {
    let format: CustomFormatDTO?

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var conditions: [EditableCondition] = []
    @State private var saving = false
    @State private var saveError: String?

    private static let typeOptions: [(value: String, label: String)] = [
        ("title_regex", "Title regex"), ("release_group", "Release group"), ("source", "Source"),
        ("codec", "Codec"), ("indexer", "Indexer"), ("language", "Language"),
        ("resolution", "Resolution"), ("seeders", "Seeders"), ("size_range", "Size range"),
        ("hdr_flag", "HDR"), ("proper_repack", "Proper/Repack"), ("freeleech", "Freeleech"),
    ]

    var body: some View {
        Form {
            Section {
                LabeledTextFieldRow(title: "Name", text: $name, autocaps: true)
            }
            ForEach($conditions) { $condition in
                conditionSection($condition)
            }
            Section {
                Button {
                    conditions.append(EditableCondition(type: "title_regex", op: "matches", value: "", negate: false))
                } label: {
                    Label("Add condition", systemImage: "plus.circle")
                }
                .listRowBackground(Theme.raised)
            }
            if let saveError {
                Section { Text(saveError).foregroundStyle(Theme.terracotta) }
                    .listRowBackground(Theme.raised)
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.base)
        .tint(Theme.apricot)
        .navigationTitle(format == nil ? "New format" : "Edit format")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if saving {
                    ProgressView().tint(Theme.apricot)
                } else {
                    Button("Save") { Task { await save() } }.disabled(name.isEmpty || conditions.isEmpty)
                }
            }
        }
        .onAppear(perform: seed)
    }

    private func conditionSection(_ condition: Binding<EditableCondition>) -> some View {
        let operators = ConditionRules.operators(for: condition.wrappedValue.type)
        let needsValue = ConditionRules.needsValue(condition.wrappedValue.op)
        return Section {
            PickerRow(title: "Type", selection: condition.type, options: Self.typeOptions)
            PickerRow(
                title: "Operator",
                selection: condition.op,
                options: operators.map { (value: $0, label: $0) }
            )
            if needsValue {
                LabeledTextFieldRow(
                    title: "Value",
                    text: condition.value,
                    placeholder: condition.wrappedValue.op == "between" ? "min,max" : "value"
                )
            }
            Toggle("Negate", isOn: condition.negate).tint(Theme.apricot).listRowBackground(Theme.raised)
            Button("Remove condition", role: .destructive) {
                conditions.removeAll { $0.id == condition.wrappedValue.id }
            }
            .listRowBackground(Theme.raised)
        }
        .onChange(of: condition.wrappedValue.type) { _, newType in
            let allowed = ConditionRules.operators(for: newType)
            if !allowed.contains(condition.wrappedValue.op) {
                condition.wrappedValue.op = allowed.first ?? ""
            }
        }
    }

    private func seed() {
        guard let format else { return }
        name = format.name
        conditions = (format.conditions ?? []).map {
            EditableCondition(type: $0.type, op: $0.op, value: $0.stringValue, negate: $0.negate)
        }
    }

    private func save() async {
        guard let client = model.api() else { return }
        saving = true; saveError = nil
        let body = SaveCustomFormatBody(
            name: name.trimmingCharacters(in: .whitespaces),
            conditions: conditions.map {
                ConditionEncodable(type: $0.type, op: $0.op, stringValue: $0.value, negate: $0.negate)
            }
        )
        do {
            if let format {
                try await client.updateCustomFormat(id: format.id, body)
            } else {
                try await client.createCustomFormat(body)
            }
            dismiss()
        } catch {
            saveError = settingsErrorMessage(error)
        }
        saving = false
    }
}
