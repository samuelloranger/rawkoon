import SwiftUI

/// Account profile (all users): edit name. Email is read-only. Avatar upload is deferred to the web app.
struct ProfileView: View {
    @Environment(AppModel.self) private var model

    @State private var loading = true
    @State private var loadError: String?
    @State private var hasProfile = false

    @State private var email = ""
    @State private var firstName = ""
    @State private var lastName = ""
    @State private var loadedFirst = ""
    @State private var loadedLast = ""
    @State private var savingName = false
    @State private var nameError: String?

    private var nameDirty: Bool {
        firstName != loadedFirst || lastName != loadedLast
    }

    var body: some View {
        Form {
            SettingsStateView(isLoading: loading, error: loadError, retry: { Task { await load() } }) {
                Section {
                    LabeledContent("Email") { Text(email).foregroundStyle(Theme.muted).textSelection(.enabled) }
                        .listRowBackground(Theme.raised)
                    LabeledTextFieldRow(title: "First name", text: $firstName, autocaps: true)
                    LabeledTextFieldRow(title: "Last name", text: $lastName, autocaps: true)
                    Button("Save name") { Task { await saveName() } }
                        .disabled(!nameDirty || savingName)
                        .requiresConnection(model.isOffline)
                        .listRowBackground(Theme.raised)
                    if let nameError {
                        Text(nameError).foregroundStyle(Theme.terracotta).listRowBackground(Theme.raised)
                    }
                } header: { Text("Profile") }
            }
        }
        .scrollContentBackground(.hidden)
        .readableWidth()
        .background(Theme.base)
        .tint(Theme.apricot)
        .navigationTitle("Profile")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { Task { await load() } }
    }

    private func load() async {
        guard let client = model.api() else { loading = false; return }
        if !hasProfile, let cached = client.cached(Endpoints.currentUser) {
            apply(cached.value.user)
        }
        loading = !hasProfile; loadError = nil
        do {
            let user = try await client.currentUser().user
            apply(user)
            if let user {
                model.applyUser(user)
            }
        } catch {
            if !hasProfile {
                loadError = settingsErrorMessage(error, admin: false)
            }
        }
        loading = false
    }

    /// A refetch landing mid-edit keeps what the user typed.
    private func apply(_ user: SessionUser?) {
        let keepEdits = hasProfile && nameDirty
        email = user?.email ?? ""
        if !keepEdits {
            firstName = user?.firstName ?? ""
            lastName = user?.lastName ?? ""
        }
        loadedFirst = user?.firstName ?? ""
        loadedLast = user?.lastName ?? ""
        hasProfile = true
    }

    private func saveName() async {
        guard let client = model.api() else { return }
        savingName = true; nameError = nil
        do {
            try await client.updateProfile(UpdateProfileBody(firstName: firstName, lastName: lastName))
            loadedFirst = firstName
            loadedLast = lastName
        } catch {
            nameError = String(localized: "Couldn't save your name.")
        }
        savingName = false
    }
}
