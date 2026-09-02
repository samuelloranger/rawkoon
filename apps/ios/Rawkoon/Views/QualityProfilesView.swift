import SwiftUI

struct QualityProfilesView: View {
    @Environment(AppModel.self) private var model

    @State private var profiles: [QualityProfile] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

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
            } else {
                VStack(spacing: 0) {
                    List {
                        ForEach(profiles) { profile in
                            profileRow(profile)
                                .listRowBackground(Theme.raised)
                        }
                    }
                    .scrollContentBackground(.hidden)
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
        .padding(.top, 28)
    }

    private func load() async {
        isLoading = true
        errorMessage = nil

        guard let client = model.api() else {
            isLoading = false
            errorMessage = "Not signed in."
            return
        }

        do {
            let response = try await client.qualityProfiles()
            profiles = response.profiles
        } catch let error as APIError {
            errorMessage = message(for: error)
        } catch {
            errorMessage = "Network error. Check your connection."
        }

        isLoading = false
    }

    private func message(for error: APIError) -> String {
        switch error {
        case .unauthorized:
            "Admin only."
        case let .http(status):
            "Server error (\(status))."
        case .decode:
            "Could not parse server response."
        case .transport:
            "Network error. Check your connection."
        }
    }
}
