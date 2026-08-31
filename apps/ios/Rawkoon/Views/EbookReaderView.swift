import QuickLook
import SwiftUI

struct EbookPreviewDocument: Identifiable, Sendable {
    let id: Int
    let title: String
    let localURL: URL
}

struct EbookReaderSheet: UIViewControllerRepresentable {
    let document: EbookPreviewDocument

    func makeCoordinator() -> Coordinator {
        Coordinator(document: document)
    }

    func makeUIViewController(context: Context) -> QLPreviewController {
        let controller = QLPreviewController()
        controller.dataSource = context.coordinator
        return controller
    }

    func updateUIViewController(_ uiViewController: QLPreviewController, context: Context) {
        context.coordinator.document = document
        uiViewController.reloadData()
    }

    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        var document: EbookPreviewDocument

        init(document: EbookPreviewDocument) {
            self.document = document
        }

        func numberOfPreviewItems(in _: QLPreviewController) -> Int { 1 }

        func previewController(_: QLPreviewController, previewItemAt _: Int) -> QLPreviewItem {
            PreviewItem(url: document.localURL, title: document.title)
        }
    }
}

private final class PreviewItem: NSObject, QLPreviewItem {
    let previewItemURL: URL?
    let previewItemTitle: String?

    init(url: URL, title: String) {
        previewItemURL = url
        previewItemTitle = title
    }
}
