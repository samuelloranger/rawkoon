import SwiftUI

private struct ChannelField {
    let key: String
    let label: String
    var secret = false
    var numeric = false
}

private enum ChannelSchema {
    static let types: [(value: String, label: String)] = [
        ("ntfy", "ntfy"), ("telegram", "Telegram"), ("discord", "Discord"),
        ("gotify", "Gotify"), ("pushover", "Pushover"), ("slack", "Slack"), ("webhook", "Webhook"),
    ]

    static func fields(for type: String) -> [ChannelField] {
        switch type {
        case "ntfy":
            [ChannelField(key: "server_url", label: "Server URL"),
             ChannelField(key: "topic", label: "Topic"),
             ChannelField(key: "access_token", label: "Access token", secret: true),
             ChannelField(key: "priority", label: "Priority", numeric: true)]
        case "telegram":
            [ChannelField(key: "bot_token", label: "Bot token", secret: true),
             ChannelField(key: "chat_id", label: "Chat ID")]
        case "discord":
            [ChannelField(key: "webhook_url", label: "Webhook URL")]
        case "gotify":
            [ChannelField(key: "server_url", label: "Server URL"),
             ChannelField(key: "app_token", label: "App token", secret: true),
             ChannelField(key: "priority", label: "Priority", numeric: true)]
        case "pushover":
            [ChannelField(key: "api_token", label: "API token", secret: true),
             ChannelField(key: "user_key", label: "User key", secret: true)]
        case "slack":
            [ChannelField(key: "webhook_url", label: "Webhook URL")]
        case "webhook":
            [ChannelField(key: "url", label: "URL"),
             ChannelField(key: "method", label: "Method (GET/POST)"),
             ChannelField(key: "body_template", label: "Body template")]
        default:
            []
        }
    }
}

/// Notification channels CRUD (per-user, not admin-gated). `GET/POST/PATCH/DELETE
/// /api/notifications/channels` + test.
struct NotificationChannelsCrudView: View {
    @Environment(AppModel.self) private var model

    @State private var channels: [NotificationChannelDTO] = []
    @State private var loading = true
    @State private var loadError: String?
    @State private var busyIds: Set<Int> = []

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
                        Button("Test") { Task { await test(channel) } }
                            .tint(Theme.apricot)
                            .disabled(busyIds.contains(channel.id))
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
        loading = true; loadError = nil
        do { channels = try await client.notificationChannels().channels }
        catch { loadError = settingsErrorMessage(error) }
        loading = false
    }

    private func delete(_ channel: NotificationChannelDTO) async {
        guard let client = model.api(), !busyIds.contains(channel.id) else { return }
        busyIds.insert(channel.id)
        let removed = channels
        channels.removeAll { $0.id == channel.id } // optimistic
        do {
            try await client.deleteNotificationChannel(id: channel.id)
            model.toast("Channel deleted.", style: .success)
        } catch {
            channels = removed // restore on failure
            model.toast(settingsErrorMessage(error), style: .error)
        }
        busyIds.remove(channel.id)
    }

    private func test(_ channel: NotificationChannelDTO) async {
        guard let client = model.api(), !busyIds.contains(channel.id) else { return }
        busyIds.insert(channel.id)
        do {
            try await client.testNotificationChannel(id: channel.id)
            model.toast("Test succeeded for \(channel.label ?? channel.type).", style: .success)
        } catch {
            model.toast("Test failed for \(channel.label ?? channel.type).", style: .error)
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

    private var fields: [ChannelField] {
        ChannelSchema.fields(for: type)
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
                Section { Text(saveError).foregroundStyle(Theme.terracotta) }.listRowBackground(Theme.raised)
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.base)
        .tint(Theme.apricot)
        .navigationTitle(channel == nil ? "New channel" : "Edit channel")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if saving {
                    ProgressView().tint(Theme.apricot)
                } else {
                    Button("Save") { Task { await save() } }.disabled(label.isEmpty)
                }
            }
        }
        .onAppear(perform: seed)
    }

    private func fieldRow(_ field: ChannelField) -> some View {
        let binding = Binding(
            get: { values[field.key] ?? "" },
            set: { values[field.key] = $0 }
        )
        return Group {
            if field.secret {
                SecretFieldRow(title: field.label, input: binding, isStored: !(values[field.key] ?? "").isEmpty)
            } else {
                LabeledTextFieldRow(title: field.label, text: binding,
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
        values = seeded
    }

    private func buildConfig() -> [String: JSONValue] {
        var config: [String: JSONValue] = [:]
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
