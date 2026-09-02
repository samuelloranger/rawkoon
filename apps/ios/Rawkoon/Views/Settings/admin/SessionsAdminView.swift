import SwiftUI

/// Active sessions + web-push subscriptions (admin). Revoke / delete only.
struct SessionsAdminView: View {
    @Environment(AppModel.self) private var model

    @State private var sessions: [AdminSessionDTO] = []
    @State private var subscriptions: [AdminWebPushDTO] = []
    @State private var loading = true
    @State private var loadError: String?
    @State private var actionError: String?

    var body: some View {
        Group {
            if !model.isAdmin {
                ContentUnavailableView("Admin only", systemImage: "lock")
            } else {
                content
            }
        }
        .navigationTitle("Sessions")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var content: some View {
        Form {
            SettingsStateView(isLoading: loading, error: loadError, retry: { Task { await load() } }) {
                Section {
                    if sessions.isEmpty {
                        Text("No active sessions.").foregroundStyle(Theme.muted).listRowBackground(Theme.raised)
                    }
                    ForEach(sessions) { session in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(session.userName ?? session.userEmail ?? "User").foregroundStyle(Theme.text)
                            Text(deviceLine(session)).font(.footnote).foregroundStyle(Theme.muted)
                        }
                        .listRowBackground(Theme.raised)
                        .swipeActions {
                            Button("Revoke", role: .destructive) { Task { await revoke(session) } }
                        }
                    }
                } header: { Text("Active sessions") }

                Section {
                    if subscriptions.isEmpty {
                        Text("No web-push subscriptions.").foregroundStyle(Theme.muted).listRowBackground(Theme.raised)
                    }
                    ForEach(subscriptions) { sub in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(sub.userName ?? sub.userEmail ?? "User").foregroundStyle(Theme.text)
                            Text(sub.deviceName ?? sub.endpoint ?? "device")
                                .font(.footnote).foregroundStyle(Theme.muted)
                        }
                        .listRowBackground(Theme.raised)
                        .swipeActions {
                            Button("Delete", role: .destructive) { Task { await deleteSub(sub) } }
                        }
                    }
                } header: { Text("Web push") }

                if let actionError {
                    Text(actionError).foregroundStyle(Theme.terracotta).listRowBackground(Theme.raised)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.base)
        .tint(Theme.apricot)
        .onAppear { Task { await load() } }
    }

    private func deviceLine(_ session: AdminSessionDTO) -> String {
        [session.device?.browser, session.device?.os, session.ipAddress]
            .compactMap { $0 }.joined(separator: " \u{2022} ")
    }

    private func load() async {
        guard let client = model.api() else { loading = false; return }
        loading = true; loadError = nil
        do {
            sessions = try await client.adminSessions().sessions
            subscriptions = (try? await client.adminWebPush().subscriptions) ?? []
        } catch {
            loadError = settingsErrorMessage(error)
        }
        loading = false
    }

    private func revoke(_ session: AdminSessionDTO) async {
        guard let client = model.api() else { return }
        actionError = nil
        do { try await client.revokeSession(id: session.id); await load() }
        catch { actionError = "Couldn't revoke session." }
    }

    private func deleteSub(_ sub: AdminWebPushDTO) async {
        guard let client = model.api() else { return }
        actionError = nil
        do { try await client.deleteWebPushSubscription(id: sub.id); await load() }
        catch { actionError = "Couldn't delete subscription." }
    }
}

/// API keys (admin): list, create (one-time reveal), revoke.
struct ApiKeysAdminView: View {
    @Environment(AppModel.self) private var model

    @State private var keys: [ApiKeyDTO] = []
    @State private var loading = true
    @State private var loadError: String?
    @State private var actionError: String?
    @State private var showCreate = false

    var body: some View {
        Group {
            if !model.isAdmin {
                ContentUnavailableView("Admin only", systemImage: "lock")
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
                    VStack(alignment: .leading, spacing: 2) {
                        Text(key.name ?? "Key").foregroundStyle(Theme.text)
                        Text("\(key.start ?? "")\u{2026}").font(.footnote.monospaced()).foregroundStyle(Theme.muted)
                    }
                    .listRowBackground(Theme.raised)
                    .swipeActions {
                        Button("Revoke", role: .destructive) { Task { await revoke(key) } }
                    }
                }
                if let actionError {
                    Text(actionError).foregroundStyle(Theme.terracotta).listRowBackground(Theme.raised)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.base)
        .tint(Theme.apricot)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showCreate = true } label: { Image(systemName: "plus") }
            }
        }
        .sheet(isPresented: $showCreate) {
            NavigationStack { CreateApiKeySheet(onDone: { Task { await load() } }) }
        }
        .onAppear { Task { await load() } }
    }

    private func load() async {
        guard let client = model.api() else { loading = false; return }
        loading = true; loadError = nil
        do { keys = try await client.apiKeys().apiKeys }
        catch { loadError = settingsErrorMessage(error) }
        loading = false
    }

    private func revoke(_ key: ApiKeyDTO) async {
        guard let client = model.api() else { return }
        actionError = nil
        do { try await client.deleteApiKey(id: key.id); await load() }
        catch { actionError = "Couldn't revoke key." }
    }
}

private struct CreateApiKeySheet: View {
    let onDone: () -> Void

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var expiresDays: Int? = nil
    @State private var createdKey: String?
    @State private var working = false
    @State private var error: String?

    var body: some View {
        Form {
            Section {
                LabeledTextFieldRow(title: "Name", text: $name, autocaps: true)
                NumberFieldRow("Expires in days", value: $expiresDays, range: 1 ... 365, suffix: "days")
            } footer: {
                Text("Leave expiry blank for a key that never expires.")
            }
            if let createdKey {
                Section {
                    Text(createdKey).font(.footnote.monospaced()).textSelection(.enabled)
                        .foregroundStyle(Theme.text).listRowBackground(Theme.raised)
                } header: {
                    Text("Copy now \u{2014} it won't be shown again")
                }
            }
            if let error {
                Section { Text(error).foregroundStyle(Theme.terracotta) }.listRowBackground(Theme.raised)
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.base)
        .tint(Theme.apricot)
        .navigationTitle("New API key")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { Button("Close") { dismiss() } }
            ToolbarItem(placement: .topBarTrailing) {
                if working { ProgressView().tint(Theme.apricot) }
                else if createdKey == nil {
                    Button("Create") { Task { await create() } }.disabled(name.isEmpty)
                }
            }
        }
    }

    private func create() async {
        guard let client = model.api() else { return }
        working = true; error = nil
        do {
            let response = try await client.createApiKey(CreateApiKeyBody(name: name, expiresInDays: expiresDays))
            createdKey = response.key
            onDone()
        } catch {
            self.error = "Couldn't create the key."
        }
        working = false
    }
}

/// Blocklist (admin): list of blocked releases, unblock only.
struct BlocklistAdminView: View {
    @Environment(AppModel.self) private var model

    @State private var entries: [BlocklistEntryDTO] = []
    @State private var loading = true
    @State private var loadError: String?
    @State private var actionError: String?

    var body: some View {
        Group {
            if !model.isAdmin {
                ContentUnavailableView("Admin only", systemImage: "lock")
            } else {
                content
            }
        }
        .navigationTitle("Blocklist")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var content: some View {
        Form {
            SettingsStateView(isLoading: loading, error: loadError, retry: { Task { await load() } }) {
                if entries.isEmpty {
                    Text("Nothing blocked.").foregroundStyle(Theme.muted).listRowBackground(Theme.raised)
                }
                ForEach(entries) { entry in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(entry.releaseTitle ?? "Release").foregroundStyle(Theme.text)
                        Text([entry.indexer, entry.reason].compactMap { $0 }.joined(separator: " \u{2022} "))
                            .font(.footnote).foregroundStyle(Theme.muted)
                    }
                    .listRowBackground(Theme.raised)
                    .swipeActions {
                        Button("Unblock", role: .destructive) { Task { await unblock(entry) } }
                    }
                }
                if let actionError {
                    Text(actionError).foregroundStyle(Theme.terracotta).listRowBackground(Theme.raised)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.base)
        .tint(Theme.apricot)
        .onAppear { Task { await load() } }
    }

    private func load() async {
        guard let client = model.api() else { loading = false; return }
        loading = true; loadError = nil
        do { entries = try await client.blocklist().entries }
        catch { loadError = settingsErrorMessage(error) }
        loading = false
    }

    private func unblock(_ entry: BlocklistEntryDTO) async {
        guard let client = model.api() else { return }
        actionError = nil
        do { try await client.unblock(id: entry.id); await load() }
        catch { actionError = "Couldn't unblock." }
    }
}
