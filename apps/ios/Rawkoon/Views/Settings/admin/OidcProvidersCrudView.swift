import SwiftUI

/// SSO / OIDC providers CRUD (admin). `GET/POST/PUT/DELETE
/// /api/integrations/oidc`. Slug is create-only; the redirect URI is computed.
struct OidcProvidersCrudView: View {
    @Environment(AppModel.self) private var model

    @State private var providers: [OidcProviderDTO] = []
    @State private var loading = true
    @State private var loadError: String?
    @State private var actionError: String?

    var body: some View {
        Group {
            if !model.isAdmin {
                ContentUnavailableView("Admin only", systemImage: "lock")
            } else {
                list
            }
        }
        .navigationTitle("SSO providers")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var list: some View {
        Form {
            SettingsStateView(isLoading: loading, error: loadError, retry: { Task { await load() } }) {
                if providers.isEmpty {
                    Text("No SSO providers.").foregroundStyle(Theme.muted).listRowBackground(Theme.raised)
                }
                ForEach(providers) { provider in
                    NavigationLink {
                        OidcProviderEditorView(provider: provider)
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(provider.name).foregroundStyle(Theme.text)
                            Text(provider.slug + (provider.enabled ? "" : " \u{2022} disabled"))
                                .font(.footnote).foregroundStyle(Theme.muted)
                        }
                    }
                    .listRowBackground(Theme.raised)
                    .swipeActions {
                        Button("Delete", role: .destructive) { Task { await delete(provider) } }
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
                NavigationLink { OidcProviderEditorView(provider: nil) } label: { Image(systemName: "plus") }
            }
        }
        .onAppear { Task { await load() } }
    }

    private func load() async {
        guard let client = model.api() else { loading = false; return }
        loading = true; loadError = nil
        do { providers = try await client.oidcProviders().providers }
        catch { loadError = settingsErrorMessage(error) }
        loading = false
    }

    private func delete(_ provider: OidcProviderDTO) async {
        guard let client = model.api() else { return }
        actionError = nil
        do { try await client.deleteOidcProvider(id: provider.id); await load() }
        catch { actionError = "Couldn't delete provider." }
    }
}

private struct OidcProviderEditorView: View {
    let provider: OidcProviderDTO?

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var slug = ""
    @State private var discoveryURL = ""
    @State private var iconURL = ""
    @State private var clientId = ""
    @State private var clientSecret = ""
    @State private var enabled = true
    @State private var saving = false
    @State private var saveError: String?

    private var isEdit: Bool { provider != nil }
    private var redirectURI: String {
        "\(model.serverURL)/api/auth/oauth2/callback/\(slug)"
    }

    var body: some View {
        Form {
            Section {
                LabeledTextFieldRow(title: "Name", text: $name, autocaps: true)
                if isEdit {
                    LabeledContent("Slug") { Text(slug).foregroundStyle(Theme.muted) }
                        .listRowBackground(Theme.raised)
                } else {
                    LabeledTextFieldRow(title: "Slug", text: $slug, placeholder: "e.g. authentik")
                }
                LabeledContent("Redirect URI") {
                    Text(redirectURI).font(.footnote.monospaced()).foregroundStyle(Theme.muted)
                        .textSelection(.enabled)
                }
                .listRowBackground(Theme.raised)
            }
            Section {
                LabeledTextFieldRow(title: "Discovery URL", text: $discoveryURL, keyboard: .URL)
                LabeledTextFieldRow(title: "Icon URL", text: $iconURL, keyboard: .URL)
                LabeledTextFieldRow(title: "Client ID", text: $clientId)
                SecretFieldRow(title: "Client secret", input: $clientSecret, isStored: provider?.clientSecretSet ?? false)
                Toggle("Enabled", isOn: $enabled).tint(Theme.apricot).listRowBackground(Theme.raised)
            }
            if let saveError {
                Section { Text(saveError).foregroundStyle(Theme.terracotta) }.listRowBackground(Theme.raised)
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.base)
        .tint(Theme.apricot)
        .navigationTitle(isEdit ? "Edit provider" : "New provider")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if saving { ProgressView().tint(Theme.apricot) }
                else { Button("Save") { Task { await save() } }.disabled(name.isEmpty || slug.isEmpty) }
            }
        }
        .onAppear(perform: seed)
    }

    private func seed() {
        guard let provider else { return }
        name = provider.name
        slug = provider.slug
        discoveryURL = provider.discoveryUrl ?? ""
        iconURL = provider.iconUrl ?? ""
        clientId = provider.clientId ?? ""
        enabled = provider.enabled
    }

    private func save() async {
        guard let client = model.api() else { return }
        saving = true; saveError = nil
        do {
            if let provider {
                try await client.updateOidcProvider(id: provider.id, UpdateOidcBody(
                    name: name, discoveryUrl: discoveryURL, clientId: clientId,
                    clientSecret: clientSecret.isEmpty ? nil : clientSecret,
                    enabled: enabled, iconUrl: iconURL.isEmpty ? nil : iconURL
                ))
            } else {
                try await client.createOidcProvider(CreateOidcBody(
                    slug: slug, name: name, discoveryUrl: discoveryURL, clientId: clientId,
                    clientSecret: clientSecret, enabled: enabled,
                    iconUrl: iconURL.isEmpty ? nil : iconURL
                ))
            }
            dismiss()
        } catch {
            saveError = "Couldn't save. Check the fields and try again."
        }
        saving = false
    }
}
