import RawkoonKit
import SwiftUI

extension MediaDetailView {
    // MARK: Control strip + actions menu (admin, in-library)

    /// A wanted title keeps the apricot lamp; everything else gets a search icon beside the chips.
    func titleIsWanted(_ item: LibraryMedia) -> Bool {
        if let note = item.lastSearchNote, note.isMiss {
            return true
        }
        return mediaType == "movie" ? movieCanAutoSearch(type: "movie", status: item.status) : item.status == "wanted"
    }

    /// Monitored, quality profile and search, visible from every tab.
    @ViewBuilder
    var controlStrip: some View {
        if showManagement, let item = managementItem {
            let wanted = titleIsWanted(item)
            VStack(alignment: .leading, spacing: 10) {
                GlassEffectContainer(spacing: 8) {
                    HStack(spacing: 8) {
                        monitoredChip(item)
                        qualityProfileChip(item)
                        Spacer(minLength: 0)
                        if applyingManagementChange {
                            ProgressView().tint(Theme.muted)
                        }
                        if !wanted {
                            searchIconButton
                        }
                    }
                }
                .rawkoonMotion(RawkoonMotion.snappy, value: item.monitored)

                WantedStatusLines(media: item, showsReason: true)
                if wanted {
                    wantedSearchControl(item)
                }
                if activeTab != .files {
                    if let managementNotice {
                        Text(managementNotice)
                            .font(.caption)
                            .foregroundStyle(Theme.apricotSoft)
                    }
                    if let managementError {
                        Text(managementError)
                            .font(.caption)
                            .foregroundStyle(Theme.terracotta)
                    }
                }
            }
            .padding(.horizontal, 16)
        }
    }

    private func monitoredChip(_ item: LibraryMedia) -> some View {
        Button {
            Task { await applyMonitoredChange(!item.monitored) }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: item.monitored ? "eye.fill" : "eye.slash")
                    .font(.caption2)
                    .contentTransition(.symbolEffect(.replace))
                Text("Monitored").font(.subheadline.weight(.medium))
            }
            .foregroundStyle(item.monitored ? Theme.apricot : Theme.muted)
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .glassEffect(.regular.interactive(), in: .capsule)
        }
        .buttonStyle(.plain)
        .disabled(applyingManagementChange)
        .requiresConnection(model.isOffline)
        .accessibilityValue(Text(item.monitored ? "On" : "Off"))
        .accessibilityAddTraits(.isToggle)
        .accessibilityHint(Text("Status is controlled by grabs and scans, not edited manually."))
    }

    private func qualityProfileChip(_ item: LibraryMedia) -> some View {
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
            HStack(spacing: 6) {
                Text(qualityProfileName(for: item))
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
                    .truncationMode(.tail)
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold))
            }
            .foregroundStyle(Theme.textStrong)
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .glassEffect(.regular.interactive(), in: .capsule)
        }
        .tint(Theme.apricot)
        .disabled(applyingManagementChange)
        .requiresConnection(model.isOffline)
        .accessibilityLabel(Text("Quality profile: \(qualityProfileName(for: item))"))
    }

    private var searchIconButton: some View {
        Button {
            openReleaseSearch()
        } label: {
            Image(systemName: "magnifyingglass")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.apricot)
                .frame(width: 44, height: 44)
                .glassEffect(.regular.interactive(), in: .circle)
        }
        .buttonStyle(.plain)
        .disabled(applyingManagementChange)
        .requiresConnection(model.isOffline)
        .accessibilityLabel(Text("Search releases"))
    }

    /// Movies split the lamp: tap auto-searches, the chevron opens the interactive
    /// sheet. After a miss it becomes explicit retry/choose buttons. Shows keep one
    /// "Search releases" lamp; per-season search lives in Files.
    @ViewBuilder
    private func wantedSearchControl(_ item: LibraryMedia) -> some View {
        if let note = item.lastSearchNote, note.isMiss {
            missActions
        } else if mediaType == "movie" {
            MovieAutoSearchLamp(
                isSearching: autoSearching,
                onAutoSearch: { Task { await movieAutoSearch() } },
                onChoose: { openReleaseSearch() }
            )
            .disabled(applyingManagementChange)
            .requiresConnection(model.isOffline)
        } else {
            Button {
                openReleaseSearch()
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
            .requiresConnection(model.isOffline)
        }
    }

    /// After a search that found nothing: rerun it, or pick a release by hand.
    private var missActions: some View {
        HStack(spacing: 10) {
            if mediaType == "movie" {
                Button {
                    Task { await movieAutoSearch() }
                } label: {
                    HStack(spacing: 6) {
                        if autoSearching {
                            ProgressView().tint(Theme.apricot)
                        }
                        Text("Search again")
                    }
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: 44)
                }
                .buttonStyle(.bordered)
                .tint(Theme.apricot)
                .fontWeight(.semibold)
                .disabled(autoSearching)
            }
            Button {
                openReleaseSearch()
            } label: {
                Text("Choose a release")
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.apricot)
            .foregroundStyle(Theme.onAccent)
            .fontWeight(.semibold)
        }
        .disabled(applyingManagementChange)
        .requiresConnection(model.isOffline)
    }

    /// The nav-bar overflow menu. Remove goes through the window-level confirm,
    /// because an alert on a zoom-pushed screen may not present.
    var actionsMenu: some View {
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
            .requiresConnection(model.isOffline)
            Button {
                openReleaseSearch()
            } label: {
                Label("Search releases", systemImage: "magnifyingglass")
            }
            .requiresConnection(model.isOffline)
            Button {
                Task { await runRescan() }
            } label: {
                Label("Rescan files", systemImage: "arrow.clockwise")
            }
            .requiresConnection(model.isOffline)
            Button {
                if let libraryId {
                    reencodeTarget = ReencodeTarget(selection: TranscodeSelection(mediaId: libraryId), subtitle: title)
                }
            } label: {
                Label("Re-encode…", systemImage: "gauge.with.dots.needle.67percent")
            }
            .requiresConnection(model.isOffline)
            Divider()
            Button(role: .destructive) {
                confirmRemoveFromLibrary()
            } label: {
                Label("Remove from library", systemImage: "trash")
            }
            .requiresConnection(model.isOffline)
        } label: {
            Image(systemName: "ellipsis.circle")
        }
        .disabled(applyingManagementChange || managementItem == nil)
        .accessibilityLabel("More actions")
    }

    private func confirmRemoveFromLibrary() {
        guard let targetId = libraryId else { return }
        model.pendingConfirm = ConfirmRequest(
            title: String(localized: "Remove from library?"),
            message: String(localized: "“\(title)” will leave your library. Deleting files also removes them from disk."),
            confirmTitle: String(localized: "Remove and delete files"),
            action: { Task { await removeLibraryItem(id: targetId, deleteFiles: true) } },
            secondaryTitle: String(localized: "Remove, keep files"),
            secondaryAction: { Task { await removeLibraryItem(id: targetId, deleteFiles: false) } }
        )
    }
}
