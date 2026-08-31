import SwiftUI

/// Requests tab: everyone sees their own (and others') pending/all requests;
/// admins get approve/deny actions inline.
struct RequestsView: View {
    @EnvironmentObject private var model: AppModel

    private enum Filter: String, CaseIterable, Identifiable {
        case pending = "Pending"
        case all = "All"
        var id: String { rawValue }
    }

    @State private var filter: Filter = .pending
    @State private var requests: [MediaRequest] = []
    @State private var loading = false
    @State private var errorMessage: String?
    @State private var adminNote: String?

    // Approve flow
    @State private var profiles: [QualityProfile] = []
    @State private var approvingRequest: MediaRequest?
    @State private var showApproveDialog = false
    @State private var busyRequestId: Int?

    private var visibleRequests: [MediaRequest] {
        switch filter {
        case .pending: return requests.filter { $0.status == "pending" }
        case .all: return requests
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            Picker("Filter", selection: $filter) {
                ForEach(Filter.allCases) { f in
                    Text(f.rawValue).tag(f)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.top, 8)

            if let adminNote {
                Text(adminNote)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Theme.muted)
                    .padding(.horizontal, 16)
                    .padding(.top, 6)
            }

            content
        }
        .background(Theme.base)
        .navigationTitle("Requests")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .confirmationDialog(
            "Choose a quality profile",
            isPresented: $showApproveDialog,
            titleVisibility: .visible
        ) {
            ForEach(profiles) { profile in
                Button(profile.name) {
                    Task { await approve(request: approvingRequest, profile: profile) }
                }
            }
            Button("Cancel", role: .cancel) {
                approvingRequest = nil
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        if loading && requests.isEmpty {
            VStack {
                Spacer()
                ProgressView().tint(Theme.apricot)
                Spacer()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let errorMessage, requests.isEmpty {
            VStack {
                Spacer()
                ContentUnavailableView(
                    "Couldn't load requests",
                    systemImage: "exclamationmark.triangle",
                    description: Text(errorMessage)
                )
                Spacer()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if visibleRequests.isEmpty {
            VStack {
                Spacer()
                ContentUnavailableView(
                    "No requests",
                    systemImage: "tray",
                    description: Text(filter == .pending ? "No pending requests." : "No requests yet.")
                )
                Spacer()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            List {
                ForEach(visibleRequests) { req in
                    row(req)
                        .listRowBackground(Theme.raised)
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .refreshable { await load() }
        }
    }

    private func row(_ req: MediaRequest) -> some View {
        HStack(spacing: 12) {
            BookCover(url: model.absoluteURL(req.posterUrl), size: 46, corner: 6)

            VStack(alignment: .leading, spacing: 3) {
                Text(req.title)
                    .font(.display(16))
                    .foregroundStyle(Theme.textStrong)
                    .lineLimit(1)

                Text("\(req.year ?? 0) · requested by \(req.requestedBy?.name ?? "someone")")
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
            }

            Spacer()

            if busyRequestId == req.id {
                ProgressView().tint(Theme.apricot)
            } else {
                StatusBadge(text: req.status, tint: badgeTint(req.status))
            }
        }
        .padding(.vertical, 4)
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            if req.status == "pending" {
                Button("Deny", role: .destructive) {
                    Task { await deny(request: req) }
                }
                Button("Approve") {
                    Task { await beginApprove(request: req) }
                }
                .tint(Theme.seed)
            }
        }
    }

    private func badgeTint(_ status: String) -> Color {
        switch status {
        case "approved": return Theme.seed
        case "denied": return Theme.terracotta
        default: return Theme.apricot
        }
    }

    // MARK: - Networking

    private func load() async {
        guard let client = model.api() else { return }
        loading = true
        errorMessage = nil
        defer { loading = false }
        do {
            let response = try await client.requestsList()
            requests = response.requests
        } catch APIError.unauthorized {
            errorMessage = "Admin only."
        } catch {
            errorMessage = "Something went wrong. Pull to retry."
        }
    }

    private func beginApprove(request: MediaRequest) async {
        guard let client = model.api() else { return }
        adminNote = nil
        busyRequestId = request.id
        do {
            let response = try await client.qualityProfiles()
            busyRequestId = nil
            if response.profiles.isEmpty {
                adminNote = "No quality profiles configured."
                return
            }
            profiles = response.profiles
            approvingRequest = request
            showApproveDialog = true
        } catch APIError.unauthorized {
            busyRequestId = nil
            adminNote = "Admin only."
        } catch {
            busyRequestId = nil
            adminNote = "Couldn't load quality profiles."
        }
    }

    private func approve(request: MediaRequest?, profile: QualityProfile) async {
        guard let client = model.api(), let request else { return }
        approvingRequest = nil
        busyRequestId = request.id
        defer { busyRequestId = nil }
        do {
            try await client.approveRequest(id: request.id, qualityProfileId: profile.id)
            await load()
        } catch APIError.unauthorized {
            adminNote = "Admin only."
        } catch {
            adminNote = "Couldn't approve that request."
        }
    }

    private func deny(request: MediaRequest) async {
        guard let client = model.api() else { return }
        busyRequestId = request.id
        defer { busyRequestId = nil }
        do {
            try await client.denyRequest(id: request.id, reason: nil)
            await load()
        } catch APIError.unauthorized {
            adminNote = "Admin only."
        } catch {
            adminNote = "Couldn't deny that request."
        }
    }
}
