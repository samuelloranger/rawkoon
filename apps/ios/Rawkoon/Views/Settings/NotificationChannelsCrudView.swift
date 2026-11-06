import RawkoonKit
import SwiftUI

private enum ChannelSchema {
    static let types: [(value: String, label: LocalizedStringKey)] = [
        ("ntfy", "ntfy"), ("telegram", "Telegram"), ("discord", "Discord"),
        ("gotify", "Gotify"), ("pushover", "Pushover"), ("slack", "Slack"), ("webhook", "Webhook"),
    ]
}

/// Notification channels CRUD (per-user, not admin-gated). `GET/POST/PATCH/DELETE
/// /api/notifications/channels` + test.
struct NotificationChannelsCrudView: View {
    @Environment(AppModel.self) private var model

    @State private var channels: [NotificationChannelDTO] = []
    @State private var loading = true
    @State private var loadError: String?
    @State private var busyIds: Set<Int> = []
    @State private var loadGen = 0
    @State private var hasLoaded = false

    var body: some View {
        Form {
            SettingsStateView(isLoading: loading, error: loadError, retry: { Task { await load() } }) {
                if channels.isEmpty {
                    Text("No channels yet.").foregroundStyle(Theme.muted).listRowBackground(Theme.raised)
                }
                ForEach(channels) { channel in
                    NavigationLink {
                        ChannelEditorView(channel: channel)
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(channel.label ?? channel.type).foregroundStyle(Theme.text)
                            Text(channel.type + (channel.enabled ? "" : " \u{2022} disabled"))
                                .font(.footnote).foregroundStyle(Theme.muted)
                        }
                    }
                    .listRowBackground(Theme.raised)
                    .swipeActions {
                        Button("Delete", role: .destructive) { Task { await delete(channel) } }
                            .disabled(busyIds.contains(channel.id))
                            .requiresConnection(model.isOffline)
                        Button("Test") { Task { await test(channel) } }
                            .tint(Theme.apricot)
                            .disabled(busyIds.contains(channel.id))
                            .requiresConnection(model.isOffline)
                    }
                    .overlay(alignment: .trailing) {
                        if busyIds.contains(channel.id) {
                            ProgressView().tint(Theme.muted).padding(.trailing, 4)
                        }
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .readableWidth()
        .background(Theme.base)
        .tint(Theme.apricot)
        .navigationTitle("Channels")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink { ChannelEditorView(channel: nil) } label: { Image(systemName: "plus") }
            }
        }
        .onAppear { Task { await load() } }
    }

    private func load() async {
        guard let client = model.api() else { loading = false; return }
        if !hasLoaded, let cached = client.cached(Endpoints.notificationChannels) {
            channels = cached.value.channels
            hasLoaded = true
        }
        loading = !hasLoaded; loadError = nil
        do {
            let gen = loadGen
            let fetched = try await client.notificationChannels().channels
            if gen == loadGen {
                channels = fetched
            }
            hasLoaded = true
        } catch {
            if !hasLoaded {
                loadError = settingsErrorMessage(error)
            }
        }
        loading = false
    }

    private func delete(_ channel: NotificationChannelDTO) async {
        guard let client = model.api(), !busyIds.contains(channel.id) else { return }
        busyIds.insert(channel.id)
        defer { busyIds.remove(channel.id) }
        loadGen &+= 1
        guard let idx = channels.firstIndex(where: { $0.id == channel.id }) else { return }
        let removed = channels[idx]
        channels.remove(at: idx) // optimistic (single element)
        do {
            try await client.deleteNotificationChannel(id: channel.id)
            model.toast(String(localized: "Channel deleted."), style: .success)
        } catch {
            if !channels.contains(where: { $0.id == removed.id }) {
                channels.insert(removed, at: min(idx, channels.count)) // restore just this row
            }
            model.toast(settingsErrorMessage(error), style: .error)
        }
    }

    private func test(_ channel: NotificationChannelDTO) async {
        guard let client = model.api(), !busyIds.contains(channel.id) else { return }
        busyIds.insert(channel.id)
        do {
            try await client.testNotificationChannel(id: channel.id)
            model.toast(String(localized: "Test succeeded for \(channel.label ?? channel.type)."), style: .success)
        } catch {
            model.toast(String(localized: "Test failed for \(channel.label ?? channel.type)."), style: .error)
        }
        busyIds.remove(channel.id)
    }
}

private struct ChannelEditorView: View {
    let channel: NotificationChannelDTO?

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var label = ""
    @State private var type = "ntfy"
    @State private var enabled = true
    @State private var values: [String: String] = [:]
    @State private var saving = false
    @State private var saveError: String?

    private var fields: [NotificationChannelField] {
        NotificationChannelSchema.fields(for: type)
    }

    var body: some View {
        Form {
            Section {
                LabeledTextFieldRow(title: "Label", text: $label, autocaps: true)
                if channel == nil {
                    PickerRow(title: "Type", selection: $type, options: ChannelSchema.types)
                } else {
                    LabeledContent("Type") { Text(type).foregroundStyle(Theme.muted) }
                        .listRowBackground(Theme.raised)
                    Toggle("Enabled", isOn: $enabled).tint(Theme.apricot).listRowBackground(Theme.raised)
                }
            }
            Section {
                ForEach(fields, id: \.key) { field in
                    fieldRow(field)
                }
            } header: {
                Text("Configuration")
            }
            if let saveError {
                Section { Text(saveError).foregroundStyle(Theme.danger) }.listRowBackground(Theme.raised)
            }
        }
        .scrollContentBackground(.hidden)
        .readableWidth()
        .background(Theme.base)
        .tint(Theme.apricot)
        .navigationTitle(Text(LocalizedStringKey(channel == nil ? "New channel" : "Edit channel")))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if saving {
                    ProgressView().tint(Theme.apricot)
                } else {
                    Button("Save") { Task { await save() } }.disabled(label.isEmpty).requiresConnection(model.isOffline)
                }
            }
        }
        .onAppear(perform: seed)
    }

    private func fieldRow(_ field: NotificationChannelField) -> some View {
        let binding = Binding(
            get: { values[field.key] ?? "" },
            set: { values[field.key] = $0 }
        )
        return Group {
            if field.secret {
                SecretFieldRow(title: LocalizedStringKey(field.label), input: binding,
                               isStored: !(values[field.key] ?? "").isEmpty)
            } else {
                LabeledTextFieldRow(title: LocalizedStringKey(field.label), text: binding,
                                    keyboard: field.numeric ? .numberPad : .default)
            }
        }
    }

    private func seed() {
        guard let channel else { return }
        label = channel.label ?? ""
        type = channel.type
        enabled = channel.enabled
        var seeded: [String: String] = [:]
        for (key, value) in channel.config ?? [:] {
            seeded[key] = value.stringValue
        }
        values = NotificationChannelSchema.upgradingLegacyKeys(seeded, type: channel.type)
    }

    private func buildConfig() -> [String: JSONValue] {
        var config = NotificationChannelSchema.unknownEntries(channel?.config ?? [:], type: type)
        for field in fields {
            let raw = (values[field.key] ?? "").trimmingCharacters(in: .whitespaces)
            guard !raw.isEmpty else { continue }
            config[field.key] = field.numeric ? .number(Double(raw) ?? 0) : .string(raw)
        }
        return config
    }

    private func save() async {
        guard let client = model.api() else { return }
        saving = true; saveError = nil
        do {
            if let channel {
                try await client.updateNotificationChannel(
                    id: channel.id,
                    UpdateChannelBody(label: label, enabled: enabled, config: buildConfig())
                )
            } else {
                try await client.createNotificationChannel(
                    CreateChannelBody(type: type, label: label, config: buildConfig())
                )
            }
            dismiss()
        } catch {
            saveError = settingsErrorMessage(error)
        }
        saving = false
    }
}
