import RawkoonKit
import SwiftUI

/// Download-client completion hook (admin). camelCase wire — plain-casing helpers.
/// `GET/PUT /api/integrations/download-client/hook` + rotate.
struct DownloadClientHookView: View {
    @Environment(AppModel.self) private var model

    @State private var loading = true
    @State private var loadError: String?
    @State private var saving = false
    @State private var saveError: String?
    @State private var confirmRotate = false

    @State private var status = ""
    @State private var callbackURL = ""
    @State private var autoConfigure = false
    @State private var activeHookedSecs: Int? = 60

    private struct FormValues: Equatable {
        var callbackURL: String
        var autoConfigure: Bool
        var activeHookedSecs: Int?
    }
    @State private var loaded = FormValues(callbackURL: "", autoConfigure: false, activeHookedSecs: 60)

    private var current: FormValues {
        FormValues(callbackURL: callbackURL, autoConfigure: autoConfigure, activeHookedSecs: activeHookedSecs)
    }
    private var isDirty: Bool { current != loaded }

    var body: some View {
        Group {
            if !model.isAdmin {
                ContentUnavailableView("Admin only", systemImage: "lock")
            } else {
                form
            }
        }
        .navigationTitle("Completion hook")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var form: some View {
        Form {
            SettingsStateView(isLoading: loading, error: loadError, retry: { Task { await load() } }) {
                if !status.isEmpty {
                    Section {
                        LabeledContent("Status") { Text(status).foregroundStyle(Theme.muted) }
                            .listRowBackground(Theme.raised)
                    }
                }
                Section {
                    LabeledTextFieldRow(title: "Callback URL", text: $callbackURL,
                                        placeholder: "https://…", keyboard: .URL)
                    ToggleRow("Auto-configure", isOn: $autoConfigure)
                    NumberFieldRow("Active-hooked seconds", value: $activeHookedSecs, range: 1 ... 86_400, suffix: "s")
                }
                Section {
                    Button("Rotate secret", role: .destructive) { confirmRotate = true }
                        .listRowBackground(Theme.raised)
                }
                if let saveError {
                    Section { Text(saveError).foregroundStyle(Theme.terracotta) }
                        .listRowBackground(Theme.raised)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.base)
        .tint(Theme.apricot)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if saving { ProgressView().tint(Theme.apricot) }
                else { Button("Save") { Task { await save() } }.disabled(!isDirty) }
            }
        }
        .confirmationDialog("Rotate the hook secret?", isPresented: $confirmRotate, titleVisibility: .visible) {
            Button("Rotate", role: .destructive) { Task { await rotate() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Old callback URLs stop working until reconfigured.")
        }
        .task { await load() }
    }

    private func apply(_ hook: HookConfigDTO) {
        status = hook.status ?? ""
        callbackURL = hook.callbackUrl ?? ""
        autoConfigure = hook.autoConfigure ?? false
        activeHookedSecs = hook.activeHookedSecs ?? 60
        loaded = current
    }

    private func load() async {
        guard let client = model.api() else { loading = false; return }
        loading = true; loadError = nil
        do { apply(try await client.downloadClientHook()) }
        catch { loadError = settingsErrorMessage(error) }
        loading = false
    }

    private func save() async {
        guard let client = model.api() else { return }
        saving = true; saveError = nil
        do {
            let updated = try await client.saveDownloadClientHook(
                SaveHookBody(
                    callbackUrl: callbackURL.isEmpty ? nil : callbackURL,
                    autoConfigure: autoConfigure,
                    activeHookedSecs: activeHookedSecs
                )
            )
            apply(updated)
        } catch {
            saveError = settingsErrorMessage(error)
        }
        saving = false
    }

    private func rotate() async {
        guard let client = model.api() else { return }
        saving = true; saveError = nil
        do {
            try await client.rotateDownloadClientHook()
            await load()
        } catch {
            saveError = settingsErrorMessage(error)
        }
        saving = false
    }
}
