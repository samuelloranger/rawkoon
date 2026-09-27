import Foundation

/// Why a request never got an HTTP answer, from its `NSURLErrorDomain` code.
///
/// Codes rather than `URLError` so this stays testable on Linux, where
/// `URLError` lives in a separate module.
public enum NetworkFailure: Equatable, Sendable {
    /// The phone has no usable connection (airplane mode, no signal, Low Data
    /// Mode blocking the request).
    case offline
    /// Connected, but the server did not answer in time.
    case timedOut
    /// Connected, but the server could not be reached (DNS, refused, TLS, dropped).
    case unreachable

    public static func classify(urlErrorCode code: Int) -> NetworkFailure {
        switch code {
        case -1009, -1020, -1018: .offline // notConnectedToInternet, dataNotAllowed, internationalRoamingOff
        case -1001: .timedOut
        default: .unreachable
        }
    }
}
