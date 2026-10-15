import Foundation
import RawkoonKit

// Audiobook <-> ebook handoff: the server matches the spot by transcript.

extension APIClient {
    /// Transcription runs server-side and can queue behind other calls, so it gets far more than the 15 s JSON lane.
    private static let handoffTimeout: TimeInterval = 90

    func handoffToEbook(bookId: Int, positionSecs: Double) async throws -> BookHandoff.EbookSpot {
        let data = try await postHandoff(
            "/api/books/\(bookId)/handoff/to-ebook",
            body: BookHandoff.ToEbookBody(positionSecs: positionSecs)
        )
        guard let spot = BookHandoff.parseEbookSpot(data) else { throw APIError.decode }
        return spot
    }

    func handoffToAudiobook(bookId: Int, spinePath: String, progression: Double) async throws -> Double {
        let data = try await postHandoff(
            "/api/books/\(bookId)/handoff/to-audiobook",
            body: BookHandoff.ToAudiobookBody(spinePath: spinePath, progression: progression)
        )
        guard let secs = BookHandoff.parseAudiobookPosition(data) else { throw APIError.decode }
        return secs
    }

    private func postHandoff(_ path: String, body: some Encodable) async throws -> Data {
        var request = try makeRequest(path: path, method: "POST", requiresAuth: true)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await perform(request, longWait: true, timeout: Self.handoffTimeout)
        try checkStatus(data, response)
        return data
    }
}

extension APIError {
    /// The handoff failure bucket; a timeout or lost connection reads as unreachable.
    var handoffFailure: BookHandoff.Failure {
        switch self {
        case let .server(status, code): BookHandoff.classify(status: status, code: code)
        case let .http(status): BookHandoff.classify(status: status)
        case .transport, .offline: .unreachable
        case .unauthorized, .forbidden, .decode: .other
        }
    }

    var handoffMessage: String {
        switch handoffFailure {
        case .syncOff: String(localized: "Book sync is off. Turn it on in AI settings.")
        case .budgetSpent: String(localized: "Book sync budget for today is spent.")
        case .rateLimited: String(localized: "Too many book sync requests. Try again later.")
        case .spotNotFound: String(localized: "Couldn't find this spot. Try a little further on.")
        case .unreachable: String(localized: "Couldn't reach the transcription service.")
        case .needsBothEditions: String(localized: "This book needs both an ebook and an audiobook.")
        case .other: userMessage()
        }
    }
}
