import RawkoonKit
import SwiftUI

/// API keys (admin): list, create (one-time reveal + MCP setup), edit MCP scopes, revoke.
struct ApiKeysAdminView: View {
    @Environment(AppModel.self) private var model

    @State private var keys: [ApiKeyDTO] = []
    @State private var loading = true
    @State private var loadError: String?
    @State private var busyIds: Set<String> = []
    @State private var loadGen = 0
    @State private var showCreate = false
    @State private var editing: ApiKeyDTO?

    var body: some View {
        Group {
            if !model.isAdmin {
                ContentUnavailableView("Admin only", systemImage: "lock")
                    .rawkoonLivingSymbol(.empty)
            } else {
                content
            }
        }
        .navigationTitle("API keys")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var content: some View {
        Form {
            SettingsStateView(isLoading: loading, error: loadError, retry: { Task { await load() } }) {
                if keys.isEmpty {
                    Text("No API keys.").foregroundStyle(Theme.muted).listRowBackground(Theme.raised)
                }
                ForEach(keys) { key in
                    Button { editing = key } label: { row(key) }
                        .buttonStyle(.plain)
                        .listRowBackground(Theme.raised)
                        .swipeActions {
                            Button("Revoke", role: .destructive) { confirmRevoke(key) }
                                .disabled(busyIds.contains(key.id))
                                .requiresConnection(model.isOffline)
                        }
                        .overlay(alignment: .trailing) {
                            if busyIds.contains(key.id) {
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
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showCreate = true } label: { Image(systemName: "plus") }
                    .accessibilityLabel("New API key")
            }
        }
        .sheet(isPresented: $showCreate) {
            NavigationStack { CreateApiKeySheet(onDone: { Task { await load() } }) }
        }
        .sheet(item: $editing) { key in
            NavigationStack { EditMcpScopesSheet(apiKey: key, onSaved: { Task { await load() } }) }
        }
        .onAppear { Task { await load() } }
    }

    private func row(_ key: ApiKeyDTO) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(key.name ?? String(localized: "Key")).foregroundStyle(Theme.text)
            Text("\(key.start ?? key.prefix ?? "")\u{2026}").font(.footnote.monospaced()).foregroundStyle(Theme.muted)
            Text(detailLine(key)).font(.footnote).foregroundStyle(Theme.muted)
            if !key.mcpScopes.isEmpty {
                Text("MCP: \(key.mcpScopes.joined(separator: ", "))").font(.footnote).foregroundStyle(Theme.apricot)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    private func detailLine(_ key: ApiKeyDTO) -> String {
        func date(_ raw: String?) -> String? {
            raw.flatMap(APIClient.parseISO8601).map { $0.formatted(date: .abbreviated, time: .omitted) }
        }
        let never = String(localized: "Never")
        return [
            String(localized: "Created \(date(key.createdAt) ?? "—")"),
            String(localized: "Last used \(date(key.lastUsedAt) ?? never)"),
            String(localized: "Expires \(date(key.expiresAt) ?? never)"),
        ].joined(separator: " \u{2022} ")
    }

    private func load() async {
        guard let client = model.api() else { loading = false; return }
        loading = true; loadError = nil
        do {
            let gen = loadGen
            let fetched = try await client.apiKeys().apiKeys
            if gen == loadGen {
                keys = fetched
            }
        } catch { loadError = settingsErrorMessage(error) }
        loading = false
    }

    private func confirmRevoke(_ key: ApiKeyDTO) {
        model.pendingConfirm = ConfirmRequest(
            title: String(localized: "Revoke this API key?"),
            message: String(localized: "Any integration using it will stop working immediately."),
            confirmTitle: String(localized: "Revoke"),
            action: { Task { await revoke(key) } }
        )
    }

    private func revoke(_ key: ApiKeyDTO) async {
        guard let client = model.api(), !busyIds.contains(key.id) else { return }
        busyIds.insert(key.id)
        defer { busyIds.remove(key.id) }
        loadGen &+= 1
        guard let idx = keys.firstIndex(where: { $0.id == key.id }) else { return }
        let removed = keys[idx]
        keys.remove(at: idx) // optimistic (single element)
        do {
            try await client.deleteApiKey(id: key.id)
            model.toast(String(localized: "Key revoked."), style: .success)
        } catch {
            if !keys.contains(where: { $0.id == removed.id }) {
                keys.insert(removed, at: min(idx, keys.count)) // restore just this row
            }
            model.toast(String(localized: "Couldn't revoke key."), style: .error)
        }
    }
}

// MARK: - Shared pieces

private struct McpScopeToggles: View {
    @Binding var scopes: [String]

    private let labels: [(scope: String, label: LocalizedStringKey)] = [
        ("read", "Read (library, search, downloads, requests)"),
        ("request", "Request titles"),
        ("approve", "Approve requests"),
        ("admin", "Admin (health self-check)"),
    ]

    var body: some View {
        ForEach(labels, id: \.scope) { item in
            Toggle(item.label, isOn: Binding(
                get: { scopes.contains(item.scope) },
                set: { on in
                    scopes.removeAll { $0 == item.scope }
                    if on {
                        scopes.append(item.scope)
                    }
                    scopes = McpSetup.scopes.filter(scopes.contains)
                }
            ))
            .listRowBackground(Theme.raised)
        }
    }
}

private struct CopyableCommand: View {
    @Environment(AppModel.self) private var model
    let label: String
    let text: String
    var hint: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(verbatim: label).font(.footnote.weight(.medium)).foregroundStyle(Theme.muted)
            Text(verbatim: text).font(.footnote.monospaced()).foregroundStyle(Theme.text).textSelection(.enabled)
            if let hint {
                Text(hint).font(.caption).foregroundStyle(Theme.muted)
            }
            Button {
                UIPasteboard.general.string = text
                model.toast(String(localized: "Copied."), style: .success)
            } label: {
                Label("Copy", systemImage: "doc.on.doc")
            }
            .buttonStyle(.borderless)
        }
        .listRowBackground(Theme.raised)
    }
}

/// Endpoint + per-client commands; `key` is the plaintext right after creation, nil otherwise.
private struct McpCommandsSection: View {
    @Environment(AppModel.self) private var model
    let key: String?

    var body: some View {
        let url = McpSetup.endpoint(server: model.serverURL)
        Section {
            CopyableCommand(label: String(localized: "Endpoint"), text: url)
            ForEach(McpSetup.commands(url: url, key: key ?? McpSetup.keyPlaceholder), id: \.client) { c in
                CopyableCommand(
                    label: c.client,
                    text: c.command,
                    hint: c.hint.map { _ in String(localized: "The variable must be set in the shell that runs codex.") }
                )
            }
        } header: {
            Text("MCP setup")
        } footer: {
            if key != nil {
                Text("The commands above include the key in clear text — copy them now, the key is shown only once.")
            } else {
                Text("Replace <your key> in the commands with this API key's value. The key itself is not shown again.")
            }
        }
    }
}

// MARK: - Sheets

private struct CreateApiKeySheet: View {
    let onDone: () -> Void

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var expiresDays: Int? = nil
    @State private var scopes: [String] = []
    @State private var created: CreateApiKeyResponse?
    @State private var working = false
    @State private var error: String?

    var body: some View {
        Form {
            if let created {
                Section {
                    Text(verbatim: created.key).font(.footnote.monospaced()).textSelection(.enabled)
                        .foregroundStyle(Theme.text).listRowBackground(Theme.raised)
                    Button {
                        UIPasteboard.general.string = created.key
                        model.toast(String(localized: "Copied."), style: .success)
                    } label: {
                        Label("Copy", systemImage: "doc.on.doc")
                    }
                    .listRowBackground(Theme.raised)
                } header: {
                    Text("Copy your API key now")
                } footer: {
                    Text("This is the only time the key will be shown. Copy it somewhere safe.")
                }
                if !created.apiKey.mcpScopes.isEmpty {
                    McpCommandsSection(key: created.key)
                }
            } else {
                Section {
                    LabeledTextFieldRow(title: "Name", text: $name, autocaps: true)
                    NumberFieldRow("Expires in days", value: $expiresDays, range: 1 ... 365, suffix: "days")
                } footer: {
                    Text("Leave expiry blank for a key that never expires.")
                }
                Section {
                    McpScopeToggles(scopes: $scopes)
                } header: {
                    Text("MCP access")
                } footer: {
                    Text("Optional: let AI clients (Claude Code, Claude Desktop, OpenCode, Codex CLI) use Rawkoon through this key.")
                }
            }
            if let error {
                Section { Text(error).foregroundStyle(Theme.danger) }.listRowBackground(Theme.raised)
            }
        }
        .scrollContentBackground(.hidden)
        .readableWidth()
        .background(Theme.base)
        .tint(Theme.apricot)
        .navigationTitle("New API key")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button(created == nil ? "Close" : "Done") { dismiss() }
            }
            ToolbarItem(placement: .topBarTrailing) {
                if working {
                    ProgressView().tint(Theme.apricot)
                } else if created == nil {
                    Button("Create") { Task { await create() } }
                        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                        .requiresConnection(model.isOffline)
                }
            }
        }
    }

    private func create() async {
        guard let client = model.api() else { return }
        working = true; error = nil
        do {
            created = try await client.createApiKey(CreateApiKeyBody(
                name: name.trimmingCharacters(in: .whitespaces), expiresInDays: expiresDays, mcpScopes: scopes
            ))
            onDone()
        } catch {
            self.error = String(localized: "Couldn't create the key.")
        }
        working = false
    }
}

private struct EditMcpScopesSheet: View {
    let apiKey: ApiKeyDTO
    let onSaved: () -> Void

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var scopes: [String]
    @State private var working = false

    init(apiKey: ApiKeyDTO, onSaved: @escaping () -> Void) {
        self.apiKey = apiKey
        self.onSaved = onSaved
        _scopes = State(initialValue: apiKey.mcpScopes)
    }

    var body: some View {
        Form {
            Section {
                McpScopeToggles(scopes: $scopes)
            } header: {
                Text("MCP access")
            } footer: {
                Text("Change what the key \"\(apiKey.name ?? apiKey.start ?? "")\" may do, and copy a setup command for your MCP client.")
            }
            if !scopes.isEmpty {
                McpCommandsSection(key: nil)
            }
        }
        .scrollContentBackground(.hidden)
        .readableWidth()
        .background(Theme.base)
        .tint(Theme.apricot)
        .navigationTitle("MCP access")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { Button("Close") { dismiss() } }
            ToolbarItem(placement: .topBarTrailing) {
                if working {
                    ProgressView().tint(Theme.apricot)
                } else {
                    Button("Save scopes") { Task { await save() } }
                        .disabled(Set(scopes) == Set(apiKey.mcpScopes))
                        .requiresConnection(model.isOffline)
                }
            }
        }
    }

    private func save() async {
        guard let client = model.api() else { return }
        working = true
        defer { working = false }
        do {
            _ = try await client.updateApiKeyScopes(id: apiKey.id, scopes: scopes)
            model.toast(String(localized: "MCP scopes updated"), style: .success)
            onSaved()
            dismiss()
        } catch {
            model.toast(String(localized: "Failed to update MCP scopes"), style: .error)
        }
    }
}
