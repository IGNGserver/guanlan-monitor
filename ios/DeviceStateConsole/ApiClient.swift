import Foundation

public actor ApiClient {
    private var session: URLSession
    private var sessionCookies: [HTTPCookie] = []
    
    public init() {
        let config = URLSessionConfiguration.default
        config.httpCookieStorage = HTTPCookieStorage.shared
        config.httpCookieAcceptPolicy = .always
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 30
        self.session = URLSession(configuration: config)
    }
    
    public static func normalizeServerUrl(_ urlString: String) -> String {
        let trimmed = urlString.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return "" }
        let withScheme = trimmed.contains("://") ? trimmed : "http://\(trimmed)"
        guard let url = URL(string: withScheme), var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return trimmed
        }
        if let port = components.port, (port == 4000 || port == 3101) {
            components.port = 3100
            return components.url?.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")) ?? trimmed
        }
        return withScheme.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }
    
    private func buildRequest(baseUrl: String, path: String, method: String = "GET", queryItems: [URLQueryItem]? = nil, body: Data? = nil) throws -> URLRequest {
        let normalizedBase = ApiClient.normalizeServerUrl(baseUrl)
        guard let base = URL(string: normalizedBase) else {
            throw URLError(.badURL)
        }
        
        var components = URLComponents(url: base.appendingPathComponent(path), resolvingAgainstBaseURL: false)
        if let queryItems = queryItems, !queryItems.isEmpty {
            components?.queryItems = queryItems
        }
        
        guard let requestURL = components?.url else {
            throw URLError(.badURL)
        }
        
        var request = URLRequest(url: requestURL)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        
        if let body = body {
            request.httpBody = body
        }
        return request
    }
    
    public func login(baseUrl: String, accessKey: String) async throws -> LoginResponseDto {
        let payload = LoginRequestDto(accessKey: accessKey)
        let bodyData = try JSONEncoder().encode(payload)
        let request = try buildRequest(baseUrl: baseUrl, path: "/api/auth/login", method: "POST", body: bodyData)
        
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw URLError(.cannotParseResponse)
        }
        
        if let url = request.url, let headerFields = httpResponse.allHeaderFields as? [String: String] {
            let cookies = HTTPCookie.cookies(withResponseHeaderFields: headerFields, for: url)
            self.sessionCookies = cookies
            HTTPCookieStorage.shared.setCookies(cookies, for: url, mainDocumentURL: nil)
        }
        
        let loginResp = try JSONDecoder().decode(LoginResponseDto.self, from: data)
        return loginResp
    }
    
    public func logout(baseUrl: String) async throws -> LoginResponseDto {
        let request = try buildRequest(baseUrl: baseUrl, path: "/api/auth/logout", method: "POST")
        let (data, _) = try await session.data(for: request)
        return try JSONDecoder().decode(LoginResponseDto.self, from: data)
    }
    
    public func fetchSession(baseUrl: String) async throws -> LoginResponseDto {
        let request = try buildRequest(baseUrl: baseUrl, path: "/api/auth/session")
        let (data, _) = try await session.data(for: request)
        return try JSONDecoder().decode(LoginResponseDto.self, from: data)
    }
    
    public func fetchDevices(baseUrl: String) async throws -> [DeviceSummaryDto] {
        let request = try buildRequest(baseUrl: baseUrl, path: "/api/devices")
        let (data, _) = try await session.data(for: request)
        return try JSONDecoder().decode([DeviceSummaryDto].self, from: data)
    }
    
    public func fetchMetrics(baseUrl: String, deviceId: String, window: String) async throws -> MetricsDto {
        let queryItems = [URLQueryItem(name: "window", value: window)]
        let request = try buildRequest(baseUrl: baseUrl, path: "/api/devices/\(deviceId)/metrics", queryItems: queryItems)
        let (data, _) = try await session.data(for: request)
        return try JSONDecoder().decode(MetricsDto.self, from: data)
    }
    
    public func fetchTrafficCalendar(baseUrl: String, deviceId: String, mode: String, anchor: String, selectedStart: String? = nil) async throws -> TrafficCalendarDto {
        var queryItems = [
            URLQueryItem(name: "mode", value: mode),
            URLQueryItem(name: "anchor", value: anchor)
        ]
        if let selectedStart = selectedStart {
            queryItems.append(URLQueryItem(name: "selectedStart", value: selectedStart))
        }
        let request = try buildRequest(baseUrl: baseUrl, path: "/api/devices/\(deviceId)/traffic-calendar", queryItems: queryItems)
        let (data, _) = try await session.data(for: request)
        return try JSONDecoder().decode(TrafficCalendarDto.self, from: data)
    }
    
    public func fetchMetricConfig(baseUrl: String, deviceId: String) async throws -> DeviceMetricConfigDto {
        let request = try buildRequest(baseUrl: baseUrl, path: "/api/devices/\(deviceId)/metric-config")
        let (data, _) = try await session.data(for: request)
        return try JSONDecoder().decode(DeviceMetricConfigDto.self, from: data)
    }
    
    public func saveMetricConfig(baseUrl: String, deviceId: String, payload: DeviceMetricConfigPayloadDto) async throws -> DeviceMetricConfigDto {
        let bodyData = try JSONEncoder().encode(payload)
        let request = try buildRequest(baseUrl: baseUrl, path: "/api/devices/\(deviceId)/metric-config", method: "PUT", body: bodyData)
        let (data, _) = try await session.data(for: request)
        return try JSONDecoder().decode(DeviceMetricConfigDto.self, from: data)
    }
}
