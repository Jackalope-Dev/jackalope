import XCTest

/// Serves the Jackalope simulator driver protocol until told to stop.
///
/// Jackalope starts this test with `xcodebuild test-without-building`, passing
/// `TEST_RUNNER_JACKALOPE_DRIVER_PORT` and `TEST_RUNNER_JACKALOPE_DRIVER_TOKEN`
/// (the runner sees them without the prefix). The driver reads and acts on any
/// app in the Simulator through XCUITest; it never needs a Simulator window.
final class Driver: XCTestCase {
  /// The protocol version Jackalope checks in `/health`.
  static let protocolVersion = 1
  /// A driver nobody has called for this long exits; Jackalope starts a new
  /// one on demand.
  static let idleLimit: TimeInterval = 30 * 60

  /// The last XCUITest failure, kept as an error for the current request
  /// instead of failing the test and ending the server.
  static var issue: String?

  override func record(_ issue: XCTIssue) {
    Driver.issue = issue.compactDescription
  }

  func testServe() throws {
    continueAfterFailure = true
    let environment = ProcessInfo.processInfo.environment
    guard let port = environment["JACKALOPE_DRIVER_PORT"].flatMap(UInt16.init),
      let token = environment["JACKALOPE_DRIVER_TOKEN"], token.count >= 16
    else {
      print("JACKALOPE_DRIVER_ERROR missing port or token")
      return
    }
    let server = try Server(port: port, token: token)
    let actions = Actions()
    server.handler = { request in
      Driver.issue = nil
      do {
        switch (request.method, request.path) {
        case ("GET", "/health"):
          return Response(status: 200, body: ["ok": true, "version": Driver.protocolVersion])
        case ("POST", "/snapshot"):
          return Response(status: 200, body: try actions.snapshot(request.json()))
        case ("POST", "/act"):
          return Response(status: 200, body: try actions.act(request.json()))
        case ("POST", "/app"):
          return Response(status: 200, body: try actions.app(request.json()))
        case ("POST", "/stop"):
          server.stopped = true
          return Response(status: 200, body: ["ok": true])
        default:
          return .error(404, "Unknown route.")
        }
      } catch let error as DriverError {
        return .error(400, error.message)
      } catch {
        return .error(500, String(describing: error))
      }
    }
    server.start()
    print("JACKALOPE_DRIVER_READY \(port)")
    while !server.stopped && Date().timeIntervalSince(server.lastRequest) < Driver.idleLimit {
      _ = RunLoop.main.run(mode: .default, before: Date(timeIntervalSinceNow: 0.5))
    }
    server.cancel()
  }
}
