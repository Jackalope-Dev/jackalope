import Foundation
import Network

/// One parsed HTTP request.
struct Request {
  let method: String
  let path: String
  let headers: [String: String]
  let body: Data

  /// The JSON object body, or an empty object.
  func json() throws -> [String: Any] {
    if body.isEmpty { return [:] }
    guard let object = try? JSONSerialization.jsonObject(with: body) as? [String: Any] else {
      throw DriverError("The request body must be a JSON object.")
    }
    return object
  }
}

struct Response {
  let status: Int
  let body: [String: Any]

  static func error(_ status: Int, _ message: String) -> Response {
    Response(status: status, body: ["error": message])
  }
}

struct DriverError: Error {
  let message: String
  init(_ message: String) { self.message = message }
}

/// A minimal HTTP/1.1 server on 127.0.0.1. Requests run one at a time on the
/// main thread, where XCUITest must be used; requests that arrive while one
/// runs wait in order. Every request needs the per-launch bearer token.
final class Server {
  static let bodyLimit = 1 << 20

  private let listener: NWListener
  private let token: String
  private var waiting: [(Request, NWConnection)] = []
  private var busy = false
  var handler: (Request) -> Response = { _ in .error(404, "Unknown route.") }
  private(set) var lastRequest = Date()
  var stopped = false

  init(port: UInt16, token: String) throws {
    guard let port = NWEndpoint.Port(rawValue: port) else { throw DriverError("Invalid port.") }
    let parameters = NWParameters.tcp
    parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: port)
    parameters.allowLocalEndpointReuse = true
    listener = try NWListener(using: parameters)
    self.token = token
  }

  func start() {
    listener.newConnectionHandler = { [weak self] connection in
      connection.start(queue: .main)
      self?.receive(connection, Data())
    }
    listener.start(queue: .main)
  }

  func cancel() {
    listener.cancel()
  }

  private func receive(_ connection: NWConnection, _ buffer: Data) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) {
      [weak self] data, _, complete, error in
      guard let self else { return }
      var buffer = buffer
      if let data { buffer.append(data) }
      if buffer.count > Server.bodyLimit + 16384 {
        self.send(connection, .error(413, "The request is too large."))
        return
      }
      switch Server.parse(buffer) {
      case .incomplete:
        if complete || error != nil {
          connection.cancel()
        } else {
          self.receive(connection, buffer)
        }
      case .invalid(let message):
        self.send(connection, .error(400, message))
      case .request(let request):
        self.waiting.append((request, connection))
        DispatchQueue.main.async { self.pump() }
      }
    }
  }

  private enum Parsed {
    case incomplete
    case invalid(String)
    case request(Request)
  }

  private static func parse(_ buffer: Data) -> Parsed {
    guard let end = buffer.range(of: Data("\r\n\r\n".utf8)) else {
      return buffer.count > 16384 ? .invalid("The request headers are too large.") : .incomplete
    }
    let head = String(decoding: buffer[buffer.startIndex..<end.lowerBound], as: UTF8.self)
    var lines = head.components(separatedBy: "\r\n")
    let parts = lines.removeFirst().split(separator: " ")
    guard parts.count >= 2 else { return .invalid("Malformed request line.") }
    var headers: [String: String] = [:]
    for line in lines {
      guard let colon = line.firstIndex(of: ":") else { continue }
      let name = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
      headers[name] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
    }
    let length = Int(headers["content-length"] ?? "0") ?? -1
    guard length >= 0, length <= bodyLimit else { return .invalid("Invalid Content-Length.") }
    let body = buffer[end.upperBound...]
    if body.count < length { return .incomplete }
    return .request(
      Request(
        method: String(parts[0]), path: String(parts[1]), headers: headers,
        body: Data(body.prefix(length))))
  }

  private func authorized(_ request: Request) -> Bool {
    let expected = Array("Bearer \(token)".utf8)
    let given = Array((request.headers["authorization"] ?? "").utf8)
    guard expected.count == given.count else { return false }
    var difference: UInt8 = 0
    for (a, b) in zip(expected, given) { difference |= a ^ b }
    return difference == 0
  }

  private func pump() {
    guard !busy, !waiting.isEmpty else { return }
    busy = true
    let (request, connection) = waiting.removeFirst()
    lastRequest = Date()
    let response = authorized(request) ? handler(request) : .error(401, "Unauthorized.")
    lastRequest = Date()
    busy = false
    send(connection, response)
    if !waiting.isEmpty { DispatchQueue.main.async { self.pump() } }
  }

  private func send(_ connection: NWConnection, _ response: Response) {
    var body = response.body
    if !JSONSerialization.isValidJSONObject(body) {
      body = ["error": "The driver produced a result it could not encode."]
    }
    let data = (try? JSONSerialization.data(withJSONObject: body)) ?? Data("{}".utf8)
    let reason = [200: "OK", 400: "Bad Request", 401: "Unauthorized", 404: "Not Found"][
      response.status] ?? "Error"
    var message = Data(
      "HTTP/1.1 \(response.status) \(reason)\r\nContent-Type: application/json\r\nContent-Length: \(data.count)\r\nConnection: close\r\n\r\n"
        .utf8)
    message.append(data)
    connection.send(
      content: message,
      completion: .contentProcessed { _ in connection.cancel() })
  }
}
