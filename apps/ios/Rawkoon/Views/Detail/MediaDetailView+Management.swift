import RawkoonKit
import SwiftUI

extension MediaDetailView {
    // MARK: Management (admin, in-library)

    @ViewBuilder
    var managementSections: some View {
        if managementLoading, managementItem == nil {
            ProgressView().tint(Theme.muted)
                .frame(maxWidth: .infinity)
                .padding(.top, 8)
        } else if let managementError, managementItem == nil {
            VStack(spacing: 12) {
                ContentUnavailableView(
                    "Couldn't load management",
                    systemImage: "exclamationmark.triangle",
                    description: Text(managementError)
                )
                Button {
                    Task { await refreshManagementData() }
                } label: {
                    Label("Try again", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
                .tint(Theme.apricot)
            }
            .padding(.top, 8)
        } else if let managementItem {
            managementControlsCard(managementItem)
                .id("management")
            // TV files fold into the seasons section; only movies keep a card.
            if mediaType != "tv" {
                managementFilesCard
            }
            managementDownloadsCard
            if let managementNotice {
                Text(managementNotice)
                    .font(.caption)
                    .foregroundStyle(Theme.apricotSoft)
                    .padding(.horizontal, 16)
            }
            if let managementError {
                Text(managementError)
                    .font(.caption)
                    .foregroundStyle(Theme.terracotta)
                    .padding(.horizontal, 16)
            }
        }
    }

    func managementControlsCard(_ item: LibraryMedia) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 10) {
                Text("Management")
                    .font(.sectionTitle)
                    .foregroundStyle(Theme.textStrong)
                Spacer()
                if applyingManagementChange {
                    ProgressView().tint(Theme.muted)
                }
                // The item's edit / artwork / rescan / remove actions live in one
                // overflow menu so no single control has to carry a long label.
                Menu {
                    Button {
                        showingOverridesEditor = true
                    } label: {
                        Label("Edit info", systemImage: "pencil")
                    }
                    Button {
                        showingArtworkPicker = true
                    } label: {
                        Label("Change artwork", systemImage: "photo")
                    }
                    Button {
                        Task { await runRescan() }
                    } label: {
                        Label("Rescan files", systemImage: "arrow.clockwise")
                    }
                    Divider()
                    Button(role: .destructive) {
                        pendingRemoveLibraryId = libraryId
                        pendingRemoveTitle = title
                        showingRemoveConfirm = true
                    } label: {
                        Label("Remove from library", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.title3)
                        .foregroundStyle(Theme.apricot)
                }
                .disabled(applyingManagementChange)
                .accessibilityLabel("More actions")
            }

            // The card's one lamp: searching releases is the primary reason an
            // admin opens Management.
            Button {
                releaseSearchSeason = nil
                showingReleaseSearch = true
            } label: {
                Label("Search releases", systemImage: "magnifyingglass")
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.apricot)
            .foregroundStyle(Theme.onAccent)
            .fontWeight(.semibold)
            .disabled(applyingManagementChange)

            managementDivider

            // Monitoring + quality: what the library tracks and how.
            Toggle("Monitored", isOn: Binding(
                get: { item.monitored },
                set: { newValue in Task { await applyMonitoredChange(newValue) } }
            ))
            .tint(Theme.terracotta)
            .disabled(applyingManagementChange)

            managementFieldRow(label: "Status") {
                LocalizedStatus.text(item.status)
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            }
            Text("Status is controlled by grabs and scans, not edited manually.")
                .font(.caption2)
                .foregroundStyle(Theme.faint)

            qualityProfileField(item)
        }
        .padding(14)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1))
        .padding(.horizontal, 16)
        .sheet(isPresented: $showingOverridesEditor) {
            NavigationStack {
                LibraryOverridesEditorView(item: item) { updated in
                    managementItem = updated
                    managementNotice = String(localized: "Details updated.")
                }
                .environment(model)
            }
        }
        .sheet(isPresented: $showingArtworkPicker) {
            NavigationStack {
                LibraryArtworkPickerView(item: item) { updated in
                    managementItem = updated
                    managementNotice = String(localized: "Artwork updated.")
                }
                .environment(model)
            }
        }
    }

    var managementDivider: some View {
        Divider().overlay(Theme.border)
    }

    /// A label on the left, its control/value trailing — the row shape shared by
    /// the Status and Quality-profile lines.
    func managementFieldRow(label: LocalizedStringKey, @ViewBuilder trailing: () -> some View) -> some View {
        HStack {
            Text(label)
                .font(.subheadline)
                .foregroundStyle(Theme.text)
            Spacer(minLength: 8)
            trailing()
        }
    }

    /// The quality-profile control on its own full-width line so a long profile
    /// name truncates instead of wrapping the label onto a second row.
    func qualityProfileField(_ item: LibraryMedia) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Quality profile")
                .font(.subheadline)
                .foregroundStyle(Theme.text)
            Menu {
                Picker("Quality profile", selection: Binding(
                    get: { item.qualityProfileId ?? 0 },
                    set: { newValue in Task { await applyQualityProfileChange(newValue == 0 ? nil : newValue) } }
                )) {
                    Text("None").tag(0)
                    ForEach(qualityProfiles) { profile in
                        Text(profile.name).tag(profile.id)
                    }
                }
            } label: {
                HStack(spacing: 8) {
                    Text(qualityProfileName(for: item))
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.caption2)
                        .foregroundStyle(Theme.muted)
                }
                .padding(.horizontal, 12)
                .frame(minHeight: 40)
                .frame(maxWidth: .infinity)
                .background(Theme.inset, in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.border, lineWidth: 1))
            }
            .tint(Theme.apricot)
            .disabled(applyingManagementChange)
        }
    }

    /// The selected profile's name for the field label, or "None".
    func qualityProfileName(for item: LibraryMedia) -> String {
        guard let id = item.qualityProfileId else { return String(localized: "None") }
        return qualityProfiles.first(where: { $0.id == id })?.name ?? String(localized: "None")
    }

    var managementFilesCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Files")
                    .font(.sectionTitle)
                    .foregroundStyle(Theme.textStrong)
                Spacer()
                Text("\(mediaFiles.count)")
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Theme.faint)
            }

            if mediaFiles.isEmpty {
                Text("No file metadata yet.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            } else {
                VStack(spacing: 8) {
                    ForEach(mediaFiles) { file in
                        fileRow(file, mode: .movie)
                    }
                }
            }
        }
        .padding(14)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1))
        .padding(.horizontal, 16)
    }

    func fileRow(_ file: LibraryFileInfo, mode: DetailFileRow.Mode) -> some View {
        DetailFileRow(
            file: file,
            mode: mode,
            isAdmin: model.isAdmin,
            onChanged: {
                if let libraryId {
                    store.invalidateLibraryRollup(itemID: libraryId)
                }
                Task { await refreshManagementData() }
            },
            onNotice: { managementNotice = $0; managementError = nil },
            onError: { managementError = $0 },
            onRequestDelete: { pendingMovieFileDelete = file }
        )
    }

    /// Library files keyed by season, for the seasons section. Empty unless
    /// admin + in-library (the only case `mediaFiles` is populated).
    var filesBySeason: [Int: [LibraryFileInfo]] {
        guard mediaFilesType == "show" else { return [:] }
        return Dictionary(grouping: mediaFiles) { $0.season ?? 0 }
    }

    var managementDownloadsCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Download history")
                    .font(.sectionTitle)
                    .foregroundStyle(Theme.textStrong)
                Spacer()
                Button("Clear failed") {
                    Task { await clearFailedDownloadsAction() }
                }
                .font(.caption)
                .buttonStyle(.plain)
                .foregroundStyle(Theme.apricot)
                .disabled(applyingManagementChange)
            }

            if downloads.isEmpty {
                Text("No download history yet.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            } else {
                VStack(spacing: 8) {
                    ForEach(liveDownloads) { row in
                        DetailDownloadRow(
                            row: row,
                            busy: pendingDownloadActionId == row.id,
                            onAction: { action in Task { await performDownloadAction(row.id, action: action) } },
                            onRemoveActive: { pendingDownloadRemoveId = row.id },
                            onDeleteEntry: { Task { await deleteDownloadEntryAction(row.id) } }
                        )
                    }
                }
            }
        }
        .padding(14)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.border, lineWidth: 1))
        .padding(.horizontal, 16)
    }
}
