import SwiftUI

/// General app settings (admin): TMDB region, upcoming look-ahead window, and the
/// languages to include for upcoming releases. Same endpoints as the web General
/// tab (`GET/PATCH /api/settings`). Never sends `books_enabled` — Books owns it.
struct GeneralSettingsView: View {
    @Environment(AppModel.self) private var model

    @State private var loading = true
    @State private var loadError: String?
    @State private var saving = false
    @State private var saveError: String?

    @State private var countryCode = "US"
    @State private var windowMonths = 12
    @State private var languages: Set<String> = ["en"]

    // Snapshot of the loaded values, for dirty tracking.
    private struct FormValues: Equatable {
        var countryCode: String
        var windowMonths: Int
        var languages: Set<String>
    }

    @State private var loaded = FormValues(countryCode: "US", windowMonths: 12, languages: ["en"])

    private static let windowOptions: [(value: Int, label: String)] = [
        (3, "3 months"), (6, "6 months"), (12, "1 year"), (24, "2 years"),
    ]

    private static let languageOptions: [(value: String, label: String)] = [
        ("en", "English"), ("fr", "French"), ("de", "German"), ("es", "Spanish"),
        ("it", "Italian"), ("pt", "Portuguese"), ("ja", "Japanese"), ("ko", "Korean"),
    ]

    private static let countryOptions: [(value: String, label: String)] = {
        Locale.Region.isoRegions
            .map(\.identifier)
            .filter { $0.count == 2 && $0.allSatisfy(\.isLetter) }
            .map { code in
                (value: code, label: Locale.current.localizedString(forRegionCode: code) ?? code)
            }
            .sorted { $0.label < $1.label }
    }()

    private var current: FormValues {
        FormValues(countryCode: countryCode, windowMonths: windowMonths, languages: languages)
    }

    private var isValid: Bool { SettingsValidation.hasMinSelection(languages, min: 1) }
    private var isDirty: Bool { current != loaded }

    var body: some View {
        Group {
            if !model.isAdmin {
                ContentUnavailableView("Admin only", systemImage: "lock")
            } else {
                form
            }
        }
        .navigationTitle("General")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var form: some View {
        Form {
            SettingsStateView(isLoading: loading, error: loadError, retry: { Task { await load() } }) {
                Section {
                    PickerRow(title: "Country", selection: $countryCode, options: Self.countryOptions)
                } header: {
                    Text("Region")
                } footer: {
                    Text("Used for TMDB regional discovery and release dates.")
                }

                Section {
                    PickerRow(title: "Look-ahead window", selection: $windowMonths, options: Self.windowOptions)
                    MultiSelectRow(
                        title: "Languages",
                        selected: $languages,
                        options: Self.languageOptions,
                        minSelection: 1
                    )
                } header: {
                    Text("Upcoming releases")
                } footer: {
                    Text(isValid ? "How far ahead to show upcoming movies and TV, and which languages to include."
                        : "Choose at least one language.")
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
                if saving {
                    ProgressView().tint(Theme.apricot)
                } else {
                    Button("Save") { Task { await save() } }
                        .disabled(!isDirty || !isValid)
                }
            }
        }
        .task { await load() }
    }

    private func load() async {
        guard let client = model.api() else { loading = false; return }
        loading = true
        loadError = nil
        do {
            let settings = try await client.generalSettings().settings
            countryCode = settings.countryCode
            windowMonths = settings.upcomingWindowMonths
            languages = Set(settings.upcomingLanguages.split(separator: ",").map(String.init))
            if languages.isEmpty { languages = ["en"] }
            loaded = current
        } catch {
            loadError = settingsErrorMessage(error)
        }
        loading = false
    }

    private func save() async {
        guard let client = model.api() else { return }
        saving = true
        saveError = nil
        do {
            try await client.updateGeneralSettings(
                UpdateGeneralSettingsBody(
                    countryCode: countryCode,
                    upcomingWindowMonths: windowMonths,
                    upcomingLanguages: languages.sorted().joined(separator: ",")
                )
            )
            loaded = current
        } catch {
            saveError = settingsErrorMessage(error)
        }
        saving = false
    }
}
