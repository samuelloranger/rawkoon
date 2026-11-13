import RawkoonKit
import SwiftUI

/// New shelf: start empty with a name, or pick one of the shipped recipes, which
/// fills the shelf once and leaves it an ordinary shelf to edit.
struct NewShelfSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var onCreated: (ShelfDetail) -> Void

    @State private var name = ""
    @State private var seeds: [ShelfSeed] = []
    @State private var creating = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $name)
                } header: {
                    Text("Shelf")
                } footer: {
                    Text("Start empty and add titles once it exists.")
                }
                if !seeds.isEmpty {
                    Section("Or start from a recipe") {
                        ForEach(seeds) { seed in
                            Button {
                                Task { await create(seed: seed.key) }
                            } label: {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(verbatim: seed.name)
                                        .foregroundStyle(Theme.textStrong)
                                    Text(verbatim: seed.description)
                                        .font(.caption)
                                        .foregroundStyle(Theme.muted)
                                }
                            }
                            .disabled(creating)
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.base)
            .navigationTitle("New shelf")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(creating)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await create(name: name) }
                    } label: {
                        if creating {
                            ProgressView()
                        } else {
                            Text("Create")
                        }
                    }
                    .disabled(creating || name.trimmingCharacters(in: .whitespaces).isEmpty)
                    .requiresConnection(model.isOffline)
                }
            }
            .task {
                guard let client = model.api() else { return }
                seeds = await (try? client.shelfSeeds()) ?? []
            }
            .alert(
                "Couldn't create the shelf",
                isPresented: Binding(get: { error != nil }, set: {
                    if !$0 {
                        error = nil
                    }
                })
            ) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(error ?? "")
            }
        }
    }

    private func create(name: String) async {
        await run { try await $0.createShelf(name: name.trimmingCharacters(in: .whitespaces)) }
    }

    private func create(seed: String) async {
        await run { try await $0.createShelf(seed: seed) }
    }

    private func run(_ work: (APIClient) async throws -> ShelfDetail) async {
        guard let client = model.api() else { return }
        creating = true
        defer { creating = false }
        do {
            let created = try await work(client)
            onCreated(created)
            model.toast(String(localized: "Shelf created."), style: .success)
            dismiss()
        } catch let apiError as APIError {
            error = apiError.userMessage(unauthorized: String(localized: "Sign in required."))
        } catch {
            self.error = String(localized: "Can't reach the server. Try again in a moment.")
        }
    }
}
