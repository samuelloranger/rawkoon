extension APIError {
    var isBadRequest: Bool {
        switch self {
        case .http(400), .server(400, _): true
        default: false
        }
    }
}
