import SwiftUI

/// Requests tab: everyone sees their own (and others') pending/all requests;
/// admins get approve/deny actions inline.
struct RequestsView: View {
    @Environment(AppModel.self) private var model

    private enum Filter: String, CaseIterable, Identifiable {
        case pending = "Pending"
        case all = "All"
        var id: String {
            rawValue
        }

        var title: LocalizedStringKey {
            switch self {
            case .pending: "Pending"
            case .all: "All"
            }
        }
    }

    @State private var filter: Filter = .pending
    @State private var requests: [MediaRequest] = []
    @State private var loading = false
    @State private var errorMessage: String?
    @State private var adminNote: String?

    // Approve flow
    @State private var profileOptions: [ApprovalProfileOption] = []
    @State private var approvingRequest: MediaRequest?
    @State private var busyRequestId: Int?
    @State private var denyTarget: MediaRequest?

    private var visibleRequests: [MediaRequest] {
        switch filter {
        case .pending: requests.filter { $0.status == "pending" }
        case .all: requests
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            Picker("Filter", selection: $filter) {
                ForEach(Filter.allCases) { f in
                    Text(f.title).tag(f)
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
        .sheet(item: $approvingRequest) { request in
            ProfilePickerSheet(options: profileOptions) { option in
                Task { await approve(request: request, profileId: option.id) }
            }
        }
        .rawkoonConfirm(
            "Deny this request?",
            isPresented: Binding(
                get: { denyTarget != nil },
                set: {
                    if !$0 {
                        denyTarget = nil
                    }
                }
            )
        ) {
            Button("Deny", role: .destructive) {
                if let req = denyTarget {
                    Task { await deny(request: req) }
                }
                denyTarget = nil
            }
            Button("Cancel", role: .cancel) {
                denyTarget = nil
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        if loading, requests.isEmpty {
            ProgressView().tint(Theme.apricot)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let errorMessage, requests.isEmpty {
            ContentUnavailableView(
                "Couldn't load requests",
                systemImage: "exclamationmark.triangle",
                description: Text(errorMessage)
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if visibleRequests.isEmpty {
            ContentUnavailableView(
                "No requests",
                systemImage: "tray",
                description: Text(LocalizedStringKey(filter == .pending ? "No pending requests. Request a title from Discover." : "No requests yet."))
            )
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
            // Movie/TV requests navigate to detail; book requests (no tmdbId) don't.
            if req.type != "book", let tmdbId = req.tmdbId {
                NavigationLink {
                    MediaDetailView(
                        tmdbId: tmdbId,
                        mediaType: req.type == "show" ? "tv" : "movie",
                        title: req.title,
                        posterPath: req.posterUrl,
                        libraryId: nil
                    )
                } label: {
                    rowLabel(req)
                }
                .buttonStyle(.plain)
            } else {
                rowLabel(req)
            }

            Spacer(minLength: 8)

            rowTrailing(req)
        }
        .padding(.vertical, 4)
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            if model.isAdmin, req.status == "pending" {
                Button("Deny", role: .destructive) {
                    denyTarget = req
                }
                Button("Approve") {
                    Task { await beginApprove(request: req) }
                }
                .tint(Theme.seed)
            }
        }
    }

    private func rowLabel(_ req: MediaRequest) -> some View {
        HStack(spacing: 12) {
            if req.type == "book" {
                BookCover(url: model.absoluteURL(req.posterUrl), size: 46, corner: 6)
            } else {
                MediaThumb(url: model.absoluteURL(req.posterUrl), width: 46)
            }

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(req.title)
                        .font(.display(16))
                        .foregroundStyle(Theme.textStrong)
                        .lineLimit(1)

                    if req.type == "book" {
                        StatusBadge(text: "Book", tint: Theme.muted)
                    }
                }

                Text(subtitle(for: req))
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
            }
        }
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private func rowTrailing(_ req: MediaRequest) -> some View {
        if busyRequestId == req.id {
            ProgressView().tint(Theme.apricot)
        } else if model.isAdmin, req.status == "pending" {
            HStack(spacing: 2) {
                Button {
                    Task { await beginApprove(request: req) }
                } label: {
                    Image(systemName: "checkmark")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.seed)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Approve")

                Button {
                    denyTarget = req
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.terracotta)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Deny")
            }
        } else {
            statusBadge(req.status, tint: badgeTint(req.status))
        }
    }

    private func subtitle(for req: MediaRequest) -> String {
        let requester = req.requestedBy?.name ?? "someone"
        if req.type == "book" {
            if let author = req.author, !author.isEmpty {
                return "\(author) · requested by \(requester)"
            }
            return "requested by \(requester)"
        }
        return "\(req.year ?? 0) · requested by \(requester)"
    }

    private func badgeTint(_ status: String) -> Color {
        switch status {
        case "approved": Theme.seed
        case "denied": Theme.terracotta
        default: Theme.muted
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
            errorMessage = String(localized: "Sign in required.")
        } catch {
            errorMessage = String(localized: "Something went wrong. Pull to retry.")
        }
    }

    private func beginApprove(request: MediaRequest) async {
        guard let client = model.api() else { return }
        adminNote = nil
        busyRequestId = request.id
        do {
            let options: [ApprovalProfileOption] =
                if request.type == "book" {
                    try await client.bookQualityProfiles().profiles.map { p in
                        var parts: [String] = []
                        if let f = p.cutoffFormat {
                            parts.append(f.uppercased())
                        }
                        if let mb = p.maxSizeMb {
                            parts.append("≤ \(mb) MB")
                        }
                        return ApprovalProfileOption(
                            id: p.id, name: p.name,
                            detail: parts.isEmpty ? nil : parts.joined(separator: " · ")
                        )
                    }
                } else {
                    try await client.qualityProfiles().profiles.map { p in
                        var parts: [String] = []
                        if let r = p.cutoffResolution {
                            parts.append("up to \(r)p")
                        }
                        if let gb = p.maxSizeGb {
                            parts.append("≤ \(gb) GB")
                        }
                        return ApprovalProfileOption(
                            id: p.id, name: p.name,
                            detail: parts.isEmpty ? nil : parts.joined(separator: " · ")
                        )
                    }
                }
            busyRequestId = nil
            if options.isEmpty {
                adminNote = String(localized: "No quality profiles configured.")
                return
            }
            profileOptions = options
            approvingRequest = request // presents the picker sheet via .sheet(item:)
        } catch APIError.unauthorized {
            busyRequestId = nil
            adminNote = String(localized: "Admin only.")
        } catch {
            busyRequestId = nil
            adminNote = String(localized: "Couldn't load quality profiles.")
        }
    }

    private func approve(request: MediaRequest, profileId: Int) async {
        guard let client = model.api() else { return }
        approvingRequest = nil
        busyRequestId = request.id
        defer { busyRequestId = nil }
        do {
            try await client.approveRequest(id: request.id, qualityProfileId: profileId)
            await load()
        } catch APIError.unauthorized {
            adminNote = String(localized: "Admin only.")
        } catch {
            adminNote = String(localized: "Couldn't approve that request.")
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
            adminNote = String(localized: "Admin only.")
        } catch {
            adminNote = String(localized: "Couldn't deny that request.")
        }
    }
}

/// A quality profile choice for the approve dialog — unifies `QualityProfile`
/// (movie/show) and `BookQualityProfile` (book) behind the id/name the picker needs.
private struct ApprovalProfileOption: Identifiable {
    let id: Int
    let name: String
    let detail: String?
}

/// Approve flow's profile picker. A sheet, not an alert/action-sheet: the list
/// can be long and each row carries a resolution/size detail line.
private struct ProfilePickerSheet: View {
    let options: [ApprovalProfileOption]
    let onSelect: (ApprovalProfileOption) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                ForEach(options) { option in
                    Button {
                        onSelect(option)
                        dismiss()
                    } label: {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(option.name)
                                .font(.display(16))
                                .foregroundStyle(Theme.textStrong)
                            if let detail = option.detail {
                                Text(detail)
                                    .font(.system(.caption, design: .monospaced))
                                    .foregroundStyle(Theme.muted)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .listRowBackground(Theme.raised)
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Theme.base)
            .navigationTitle("Choose a quality profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationBackground(Theme.base)
    }
}
