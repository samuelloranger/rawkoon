@testable import Rawkoon
import Testing

@MainActor
struct LibraryNotificationRefreshTests {
    @Test func readsTheMediaIdFromMetadata() {
        let notification = streamNotification(
            type: "library_media_downloaded",
            url: "/library/2542?tab=management",
            mediaId: 2542
        )

        #expect(LibraryNotification.mediaID(in: notification) == 2542)
    }

    @Test func fallsBackToTheUrlWhenMetadataOmitsTheId() {
        let notification = streamNotification(
            type: "library_media_grabbed",
            url: "/library/2542?tab=management"
        )

        #expect(LibraryNotification.mediaID(in: notification) == 2542)
    }

    @Test func ignoresNotificationsThatAreNotAboutLibraryMedia() {
        let notification = streamNotification(type: "app-update", url: "/", mediaId: nil)

        #expect(LibraryNotification.mediaID(in: notification) == nil)
    }

    @Test func ignoresABookUrlWhenLookingForMedia() {
        let notification = streamNotification(type: "book_downloaded", url: "/books/17")

        #expect(LibraryNotification.mediaID(in: notification) == nil)
    }

    @Test func attentionNotificationsAlsoRefreshTheirItem() {
        let notification = streamNotification(
            type: "library_attention",
            url: "/library/2522?tab=management"
        )

        #expect(LibraryNotification.mediaID(in: notification) == 2522)
    }

    @Test func readsTheBookIdFromMetadataOrUrl() {
        let tagged = streamNotification(type: "book_downloaded", url: "/books/53", bookId: 53)
        let untagged = streamNotification(type: "book_grabbed", url: "/books/53")

        #expect(LibraryNotification.bookID(in: tagged) == 53)
        #expect(LibraryNotification.bookID(in: untagged) == 53)
        #expect(LibraryNotification.bookID(in: streamNotification(type: "app-update", url: "/")) == nil)
    }

    @Test func aBookNotificationInvalidatesTheBookFamilies() {
        let store = ServerStateStore()

        LibraryNotification.apply(
            streamNotification(type: "book_downloaded", url: "/books/53", bookId: 53),
            to: store
        )

        #expect(store.isInvalidated(.bookItem(53)))
        #expect(store.isInvalidated(.bookList))
        #expect(store.isInvalidated(.progress))
    }

    @Test func aSilentNotificationIsMarkedSilent() {
        let silent = streamNotification(type: "app-update", url: "/", silent: true)
        let loud = streamNotification(type: "library_media_downloaded", url: "/library/1", mediaId: 1)

        #expect(LibraryNotification.isSilent(silent))
        #expect(LibraryNotification.isSilent(loud) == false)
    }

    @Test func aLibraryNotificationInvalidatesTheItemAndItsLists() {
        let store = ServerStateStore()
        let key = LibraryListKey.default
        store.seedLibraryList([movie(id: 2542)], for: key)

        let notification = streamNotification(
            type: "library_media_downloaded",
            url: "/library/2542?tab=management",
            mediaId: 2542
        )
        LibraryNotification.apply(notification, to: store)

        #expect(store.isInvalidated(.libraryItem(2542)))
        #expect(store.needsLoad(key))
    }

    @Test func anUnrelatedNotificationLeavesLibraryStateAlone() {
        let store = ServerStateStore()
        let key = LibraryListKey.default
        store.seedLibraryList([movie(id: 2542)], for: key)

        LibraryNotification.apply(
            streamNotification(type: "app-update", url: "/", mediaId: nil),
            to: store
        )

        #expect(store.needsLoad(key) == false)
    }

    private func streamNotification(
        type: String,
        url: String?,
        mediaId: Int? = nil,
        bookId: Int? = nil,
        silent: Bool? = nil
    ) -> StreamNotificationDTO {
        StreamNotificationDTO(
            id: 1,
            title: "t",
            body: "b",
            type: type,
            url: url,
            imageUrl: nil,
            metadata: NotificationMetadata(serviceName: nil, mediaId: mediaId, bookId: bookId, silent: silent)
        )
    }

    private nonisolated func movie(id: Int) -> LibraryMedia {
        LibraryMedia(
            id: id, tmdbId: id, type: "movie", title: "Movie \(id)", year: 2026,
            status: "wanted", monitored: true, posterUrl: nil, overview: nil,
            qualityProfileId: nil, qualityProfile: nil, totalSizeBytes: nil,
            episodeCount: nil, downloadedEpisodeCount: nil, seasonCount: nil,
            durationSecs: nil, resolution: nil, videoCodec: nil, hdrFormat: nil,
            audioFormat: nil, languageTags: nil, lastGrabbedAt: nil, addedAt: nil,
            digitalReleaseDate: nil
        )
    }
}
