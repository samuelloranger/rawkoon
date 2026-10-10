import SwiftUI

struct QualityProfilesView: View {
    @Environment(AppModel.self) private var model

    @State private var profiles: [QualityProfile] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var hasLoaded = false

    var body: some View {
        Group {
            if isLoading {
                ProgressView().tint(Theme.apricot).padding(.top, 28)
            } else if let errorMessage {
                errorView(errorMessage)
            } else if profiles.isEmpty {
                ContentUnavailableView(
                    "No quality profiles",
                    systemImage: "slider.horizontal.3",
                    description: Text("No quality profiles are configured on this server.")
                )
                .rawkoonLivingSymbol(.empty)
            } else {
                VStack(spacing: 0) {
                    List {
                        ForEach(profiles) { profile in
                            profileRow(profile)
                                .listRowBackground(Theme.raised)
                        }
                    }
                    .scrollContentBackground(.hidden)
                    .readableWidth()
                    .background(Theme.base)
                    .listStyle(.plain)

                    Text("\(profiles.count) profiles")
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(Theme.faint)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.vertical, 12)
                }
            }
        }
        .background(Theme.base)
        .navigationTitle("Quality profiles")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await load()
        }
    }

    private func profileRow(_ profile: QualityProfile) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(profile.name)
                    .font(.display(16))
                    .foregroundStyle(Theme.textStrong)

                Spacer()

                if profile.requireHdr == true || profile.preferHdr == true {
                    StatusBadge(text: "HDR", tint: Theme.muted)
                }
            }

            Text(metaLine(for: profile))
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(Theme.muted)
        }
        .padding(.vertical, 4)
    }

    private func metaLine(for profile: QualityProfile) -> String {
        var parts: [String] = []
        parts.append("min \(profile.minResolution ?? 0)p")
        if let cutoff = profile.cutoffResolution {
            parts.append("cutoff \(cutoff)p")
        }
        parts.append("\(profile.minSeeders ?? 0) seeders")
        if let maxSizeGb = profile.maxSizeGb {
            parts.append("\(maxSizeGb) GB")
        }
        return parts.joined(separator: " · ")
    }

    private func errorView(_ text: String) -> some View {
        ContentUnavailableView(
            "Something went wrong",
            systemImage: "exclamationmark.triangle",
            description: Text(text)
        )
        .rawkoonLivingSymbol(.error)
        .padding(.top, 28)
    }

    private func load() async {
        errorMessage = nil

        guard let client = model.api() else {
            isLoading = false
            errorMessage = String(localized: "Not signed in.")
            return
        }

        if !hasLoaded, let cached = client.cached(Endpoints.qualityProfiles) {
            profiles = cached.value.profiles
            hasLoaded = true
        }
        isLoading = !hasLoaded

        do {
            let response = try await client.qualityProfiles()
            profiles = response.profiles
            hasLoaded = true
        } catch let error as APIError {
            if !hasLoaded {
                errorMessage = message(for: error)
            }
        } catch {
            if !hasLoaded {
                errorMessage = String(localized: "Can't reach the server. Try again in a moment.")
            }
        }

        isLoading = false
    }

    private func message(for error: APIError) -> String {
        error.userMessage(
            unauthorized: String(localized: "Admin only."),
            forbidden: String(localized: "Admin only.")
        )
    }
}
