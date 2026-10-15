import RawkoonKit
import SwiftUI

extension ContinueListeningView {
    func ebookDocument(for item: ContinueEbookItem) async throws -> EbookPreviewDocument {
        try await model.ebookDocument(
            bookId: item.bookId,
            editionId: item.editionId,
            title: item.title,
            preferredFileId: item.fileId
        )
    }
}
