import XCTest

private let springboard = "com.apple.springboard"

/// An element from the latest snapshot. Actions use its frame; waits and
/// scrolling find it again by type and identifier, or label when it has none.
struct Entry {
  let bundle: String
  let type: XCUIElement.ElementType
  let identifier: String
  let label: String
  let frame: CGRect
  let value: String
  let placeholder: String

  func matches(_ node: XCUIElementSnapshot) -> Bool {
    guard node.elementType == type else { return false }
    return identifier.isEmpty ? (!label.isEmpty && node.label == label) : node.identifier == identifier
  }
}

/// Reads and acts on apps. Refs (`e1`, `e2`, ...) name elements of the latest
/// snapshot and stay valid until the next one.
final class Actions {
  private var refs: [String: Entry] = [:]
  private var screen = CGRect.zero
  private var lastBundle = springboard

  // MARK: Snapshot

  func snapshot(_ input: [String: Any]) throws -> [String: Any] {
    let bundle = try target(input)
    let app = XCUIApplication(bundleIdentifier: bundle)
    let state = app.state
    let tree = try capture(app, bundle)
    var walk = Walk(
      maxNodes: clamp(input["maxNodes"] as? Int ?? 1500, 1, 5000),
      maxDepth: clamp(input["maxDepth"] as? Int ?? 60, 1, 200))
    var found: [String: Entry] = [:]
    let root = walk.node(tree, bundle: bundle, depth: 0, into: &found)
    var result: [String: Any] = [
      "bundleId": bundle, "state": stateName(state), "screen": rect(tree.frame), "tree": root ?? [:],
    ]
    if bundle != springboard, input["alerts"] as? Bool ?? true,
      let system = try? capture(XCUIApplication(bundleIdentifier: springboard), springboard)
    {
      var alerts: [[String: Any]] = []
      collectAlerts(system, walk: &walk, into: &found, alerts: &alerts)
      if !alerts.isEmpty { result["alerts"] = alerts }
    }
    if walk.truncated { result["truncated"] = true }
    refs = found
    screen = tree.frame
    lastBundle = bundle
    return result
  }

  private func collectAlerts(
    _ node: XCUIElementSnapshot, walk: inout Walk, into found: inout [String: Entry],
    alerts: inout [[String: Any]]
  ) {
    if node.elementType == .alert {
      if let alert = walk.node(node, bundle: springboard, depth: 0, into: &found) {
        alerts.append(alert)
      }
      return
    }
    for child in node.children { collectAlerts(child, walk: &walk, into: &found, alerts: &alerts) }
  }

  // MARK: Actions

  func act(_ input: [String: Any]) throws -> [String: Any] {
    guard let action = input["action"] as? String else { throw DriverError("action is required.") }
    switch action {
    case "tap", "double_tap", "long_press":
      let (bundle, point) = try location(input)
      let target = try coordinate(bundle, point)
      switch action {
      case "tap": target.tap()
      case "double_tap": target.doubleTap()
      default: target.press(forDuration: clamp(input["duration"] as? Double ?? 1.0, 0.1, 10.0))
      }
      try check()
      return ["ok": true, "x": Int(point.x), "y": Int(point.y)]
    case "type":
      guard let text = input["text"] as? String, !text.isEmpty else {
        throw DriverError("type needs text.")
      }
      var bundle = input["bundleId"] as? String ?? lastBundle
      if let ref = input["ref"] as? String {
        let entry = try lookup(ref)
        bundle = entry.bundle
        try coordinate(bundle, center(current(entry))).tap()
        try check()
        pause(0.5)
      }
      XCUIApplication(bundleIdentifier: bundle).typeText(text)
      try check()
      return ["ok": true]
    case "clear":
      guard let ref = input["ref"] as? String else { throw DriverError("clear needs a ref.") }
      let entry = try lookup(ref)
      let frame = current(entry)
      try coordinate(entry.bundle, CGPoint(x: max(frame.minX, frame.maxX - 6), y: frame.midY)).tap()
      try check()
      pause(0.4)
      let current = entry.value == entry.placeholder ? "" : entry.value
      let deletes = String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count + 2)
      XCUIApplication(bundleIdentifier: entry.bundle).typeText(deletes)
      try check()
      var result: [String: Any] = ["ok": true]
      if let tree = try? capture(XCUIApplication(bundleIdentifier: entry.bundle), entry.bundle),
        let node = locate(tree, entry, visible: nil)
      {
        let value = text(node.value) ?? ""
        result["value"] = value == (node.placeholderValue ?? "") ? "" : value
      }
      return result
    case "swipe", "scroll":
      guard let direction = input["direction"] as? String, Self.directions.contains(direction) else {
        throw DriverError("\(action) needs direction up, down, left or right.")
      }
      var region = try screenFrame()
      var bundle = input["bundleId"] as? String ?? lastBundle
      if let ref = input["ref"] as? String {
        let entry = try lookup(ref)
        region = current(entry)
        bundle = entry.bundle
      }
      let finger = action == "scroll" ? Self.opposite(direction) : direction
      try drag(
        bundle, region, finger, clamp(input["distance"] as? Double ?? 0.5, 0.05, 0.8),
        velocity(input["velocity"]))
      return ["ok": true]
    case "scroll_to":
      guard let ref = input["ref"] as? String else { throw DriverError("scroll_to needs a ref.") }
      let entry = try lookup(ref)
      let direction = input["direction"] as? String ?? "down"
      guard Self.directions.contains(direction) else {
        throw DriverError("direction must be up, down, left or right.")
      }
      let limit = clamp(input["count"] as? Int ?? 10, 1, 25)
      let visible = try screenFrame().insetBy(dx: 0, dy: 60)
      let app = XCUIApplication(bundleIdentifier: entry.bundle)
      for swipes in 0...limit {
        let tree = try capture(app, entry.bundle)
        if let node = locate(tree, entry, visible: visible) {
          return ["ok": true, "frame": rect(node.frame), "swipes": swipes]
        }
        if swipes < limit {
          try drag(entry.bundle, try screenFrame(), Self.opposite(direction), 0.5, .default)
        }
      }
      throw DriverError(
        "\(ref) did not come into view after \(limit) swipes. Take a new snapshot to see what is on screen.")
    case "press_button":
      guard input["button"] as? String == "home" else {
        throw DriverError("The Simulator supports the home button only.")
      }
      XCUIDevice.shared.press(.home)
      try check()
      pause(1)
      return ["ok": true]
    case "rotate":
      let orientations: [String: UIDeviceOrientation] = [
        "portrait": .portrait, "portrait_upside_down": .portraitUpsideDown,
        "landscape_left": .landscapeLeft, "landscape_right": .landscapeRight,
      ]
      guard let name = input["orientation"] as? String, let orientation = orientations[name] else {
        throw DriverError(
          "orientation must be portrait, portrait_upside_down, landscape_left or landscape_right.")
      }
      XCUIDevice.shared.orientation = orientation
      try check()
      return ["ok": true]
    case "wait":
      return try wait(input)
    default:
      throw DriverError("Unknown action \(action).")
    }
  }

  private func wait(_ input: [String: Any]) throws -> [String: Any] {
    let timeout = clamp(input["timeout"] as? Double ?? 10, 0.5, 30)
    let gone = input["gone"] as? Bool ?? false
    let text = (input["text"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    let entry = try (input["ref"] as? String).map(lookup)
    guard (text == nil) != (entry == nil) else { throw DriverError("wait needs text or a ref.") }
    let bundle = try entry?.bundle ?? target(input)
    let app = XCUIApplication(bundleIdentifier: bundle)
    let started = Date()
    repeat {
      var present = false
      if let tree = try? capture(app, bundle) {
        if let text {
          present = contains(tree, text)
        } else if let entry {
          present = locate(tree, entry, visible: nil) != nil
        }
      }
      if present != gone {
        return ["ok": true, "waited": Int(Date().timeIntervalSince(started) * 1000)]
      }
      pause(0.4)
    } while Date().timeIntervalSince(started) < timeout
    let subject = text.map { "\"\($0)\"" } ?? (input["ref"] as? String ?? "")
    throw DriverError(
      "Timed out after \(Int(timeout))s waiting for \(subject) to \(gone ? "disappear" : "appear") in \(bundle).")
  }

  func app(_ input: [String: Any]) throws -> [String: Any] {
    guard let bundle = input["bundleId"] as? String, !bundle.isEmpty else {
      throw DriverError("bundleId is required.")
    }
    let app = XCUIApplication(bundleIdentifier: bundle)
    switch input["action"] as? String {
    case "state":
      break
    case "activate":
      app.activate()
      try check()
      _ = app.wait(for: .runningForeground, timeout: 5)
    case "terminate":
      if app.state != .notRunning {
        app.terminate()
        try check()
        _ = app.wait(for: .notRunning, timeout: 5)
      }
    default:
      throw DriverError("action must be state, activate or terminate.")
    }
    return ["bundleId": bundle, "state": stateName(app.state)]
  }

  // MARK: Helpers

  private static let directions: Set<String> = ["up", "down", "left", "right"]

  private static func opposite(_ direction: String) -> String {
    ["up": "down", "down": "up", "left": "right", "right": "left"][direction] ?? direction
  }

  /// The app to read: an explicit bundle ID, else the first candidate in the
  /// foreground, else the home screen.
  private func target(_ input: [String: Any]) throws -> String {
    if let bundle = input["bundleId"] as? String, !bundle.isEmpty { return bundle }
    for candidate in (input["bundleIds"] as? [String] ?? []).prefix(20)
    where XCUIApplication(bundleIdentifier: candidate).state == .runningForeground {
      return candidate
    }
    return springboard
  }

  private func capture(_ app: XCUIApplication, _ bundle: String) throws -> XCUIElementSnapshot {
    let state = app.state
    guard state != .notRunning, state != .unknown else {
      throw DriverError("\(bundle) is not running.")
    }
    do {
      let tree = try app.snapshot()
      try check()
      return tree
    } catch let error as DriverError {
      throw error
    } catch {
      throw DriverError("Could not read \(bundle): \(error.localizedDescription)")
    }
  }

  private func check() throws {
    if let issue = Driver.issue {
      Driver.issue = nil
      throw DriverError(issue)
    }
  }

  private func lookup(_ ref: String) throws -> Entry {
    let key = ref.hasPrefix("@") ? String(ref.dropFirst()) : ref
    guard let entry = refs[key] else {
      throw DriverError("Unknown ref \(ref). Take a new snapshot and use its refs.")
    }
    return entry
  }

  private func location(_ input: [String: Any]) throws -> (String, CGPoint) {
    if let ref = input["ref"] as? String {
      let entry = try lookup(ref)
      return (entry.bundle, center(current(entry)))
    }
    guard let x = number(input["x"]), let y = number(input["y"]) else {
      throw DriverError("Give a ref or x and y in points.")
    }
    let point = CGPoint(x: x, y: y)
    let bounds = try screenFrame()
    guard bounds.contains(point) else {
      throw DriverError(
        "(\(Int(x)), \(Int(y))) is outside the \(Int(bounds.width))x\(Int(bounds.height)) pt screen.")
    }
    return (input["bundleId"] as? String ?? lastBundle, point)
  }

  private func screenFrame() throws -> CGRect {
    if screen.width > 0 { return screen }
    let frame = XCUIApplication(bundleIdentifier: springboard).frame
    try check()
    screen = frame
    return frame
  }

  /// A point in screen coordinates, through the app when it is in front.
  private func coordinate(_ bundle: String, _ point: CGPoint) throws -> XCUICoordinate {
    var app = XCUIApplication(bundleIdentifier: bundle)
    if bundle != springboard, app.state != .runningForeground {
      app = XCUIApplication(bundleIdentifier: springboard)
    }
    let origin = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
    return origin.withOffset(CGVector(dx: point.x, dy: point.y))
  }

  private func drag(
    _ bundle: String, _ region: CGRect, _ finger: String, _ distance: Double,
    _ velocity: XCUIGestureVelocity
  ) throws {
    let half = distance / 2
    var start = CGPoint(x: region.midX, y: region.midY)
    var end = start
    switch finger {
    case "up":
      start.y = region.midY + region.height * half
      end.y = region.midY - region.height * half
    case "down":
      start.y = region.midY - region.height * half
      end.y = region.midY + region.height * half
    case "left":
      start.x = region.midX + region.width * half
      end.x = region.midX - region.width * half
    default:
      start.x = region.midX - region.width * half
      end.x = region.midX + region.width * half
    }
    let from = try coordinate(bundle, start)
    let to = try coordinate(bundle, end)
    from.press(forDuration: 0.05, thenDragTo: to, withVelocity: velocity, thenHoldForDuration: 0.05)
    try check()
  }

  private func velocity(_ value: Any?) -> XCUIGestureVelocity {
    if let speed = number(value) { return XCUIGestureVelocity(rawValue: CGFloat(clamp(speed, 50, 10000))) }
    switch value as? String {
    case "slow": return .slow
    case "fast": return .fast
    default: return .default
    }
  }

  /// Where the element is now. The screen may have moved since the snapshot,
  /// so the element is found again, preferring the match nearest its old frame;
  /// the snapshot's frame is used when it can no longer be found.
  private func current(_ entry: Entry) -> CGRect {
    guard let tree = try? capture(XCUIApplication(bundleIdentifier: entry.bundle), entry.bundle)
    else { return entry.frame }
    var best: (CGFloat, CGRect)?
    func visit(_ node: XCUIElementSnapshot) {
      if entry.matches(node), node.frame.width > 0, node.frame.height > 0 {
        let distance = abs(node.frame.midX - entry.frame.midX) + abs(node.frame.midY - entry.frame.midY)
        if best.map({ distance < $0.0 }) ?? true { best = (distance, node.frame) }
      }
      node.children.forEach(visit)
    }
    visit(tree)
    return best?.1 ?? entry.frame
  }

  private func locate(_ node: XCUIElementSnapshot, _ entry: Entry, visible: CGRect?)
    -> XCUIElementSnapshot?
  {
    if entry.matches(node), node.frame.width > 0, node.frame.height > 0,
      visible.map({ $0.contains(center(node.frame)) }) ?? true
    {
      return node
    }
    for child in node.children {
      if let found = locate(child, entry, visible: visible) { return found }
    }
    return nil
  }

  private func contains(_ node: XCUIElementSnapshot, _ needle: String) -> Bool {
    for haystack in [node.label, node.identifier, text(node.value) ?? ""]
    where haystack.range(of: needle, options: .caseInsensitive) != nil {
      return true
    }
    return node.children.contains { contains($0, needle) }
  }

  private func pause(_ seconds: TimeInterval) {
    _ = RunLoop.main.run(mode: .default, before: Date(timeIntervalSinceNow: seconds))
  }
}

/// Turns a snapshot into compact JSON, numbering every node it keeps.
struct Walk {
  let maxNodes: Int
  let maxDepth: Int
  var count = 0
  var truncated = false

  mutating func node(
    _ node: XCUIElementSnapshot, bundle: String, depth: Int, into refs: inout [String: Entry]
  ) -> [String: Any]? {
    guard count < maxNodes else {
      truncated = true
      return nil
    }
    count += 1
    let ref = "e\(count)"
    let value = text(node.value) ?? ""
    let placeholder = node.placeholderValue ?? ""
    refs[ref] = Entry(
      bundle: bundle, type: node.elementType, identifier: node.identifier, label: node.label,
      frame: node.frame, value: value, placeholder: placeholder)
    var out: [String: Any] = ["ref": ref, "type": typeName(node.elementType), "frame": rect(node.frame)]
    if !node.label.isEmpty { out["label"] = clip(node.label) }
    if !node.identifier.isEmpty { out["id"] = clip(node.identifier) }
    if !value.isEmpty { out["value"] = clip(value) }
    if !placeholder.isEmpty { out["placeholder"] = clip(placeholder) }
    if !node.isEnabled { out["disabled"] = true }
    if node.isSelected { out["selected"] = true }
    if node.hasFocus { out["focused"] = true }
    if depth >= maxDepth {
      if !node.children.isEmpty {
        out["more"] = node.children.count
        truncated = true
      }
      return out
    }
    var children: [[String: Any]] = []
    for child in node.children {
      if let kept = self.node(child, bundle: bundle, depth: depth + 1, into: &refs) {
        children.append(kept)
      }
    }
    if !children.isEmpty { out["children"] = children }
    return out
  }
}

func text(_ value: Any?) -> String? {
  switch value {
  case let string as String: return string
  case let number as NSNumber: return number.stringValue
  case nil: return nil
  case let other?: return String(describing: other)
  }
}

func clip(_ text: String) -> String {
  text.count > 300 ? String(text.prefix(300)) + "…" : text
}

func number(_ value: Any?) -> Double? {
  guard let number = value as? NSNumber, number.doubleValue.isFinite else { return nil }
  return number.doubleValue
}

func clamp<T: Comparable>(_ value: T, _ low: T, _ high: T) -> T {
  min(max(value, low), high)
}

func center(_ frame: CGRect) -> CGPoint {
  CGPoint(x: frame.midX, y: frame.midY)
}

func rect(_ frame: CGRect) -> [Int] {
  [frame.minX, frame.minY, frame.width, frame.height].map { $0.isFinite ? Int($0.rounded()) : 0 }
}

func stateName(_ state: XCUIApplication.State) -> String {
  switch state {
  case .notRunning: return "notRunning"
  case .runningBackgroundSuspended: return "suspended"
  case .runningBackground: return "background"
  case .runningForeground: return "foreground"
  default: return "unknown"
  }
}

private let typeNames: [XCUIElement.ElementType: String] = [
  .other: "other", .application: "application", .group: "group", .window: "window",
  .sheet: "sheet", .drawer: "drawer", .alert: "alert", .dialog: "dialog", .button: "button",
  .radioButton: "radioButton", .radioGroup: "radioGroup", .checkBox: "checkBox",
  .disclosureTriangle: "disclosureTriangle", .popUpButton: "popUpButton", .comboBox: "comboBox",
  .menuButton: "menuButton", .toolbarButton: "toolbarButton", .popover: "popover",
  .keyboard: "keyboard", .key: "key", .navigationBar: "navigationBar", .tabBar: "tabBar",
  .tabGroup: "tabGroup", .toolbar: "toolbar", .statusBar: "statusBar", .table: "table",
  .tableRow: "tableRow", .tableColumn: "tableColumn", .outline: "outline",
  .outlineRow: "outlineRow", .browser: "browser", .collectionView: "collectionView",
  .slider: "slider", .pageIndicator: "pageIndicator", .progressIndicator: "progressIndicator",
  .activityIndicator: "activityIndicator", .segmentedControl: "segmentedControl",
  .picker: "picker", .pickerWheel: "pickerWheel", .switch: "switch", .toggle: "toggle",
  .link: "link", .image: "image", .icon: "icon", .searchField: "searchField",
  .scrollView: "scrollView", .scrollBar: "scrollBar", .staticText: "staticText",
  .textField: "textField", .secureTextField: "secureTextField", .datePicker: "datePicker",
  .textView: "textView", .menu: "menu", .menuItem: "menuItem", .menuBar: "menuBar",
  .menuBarItem: "menuBarItem", .map: "map", .webView: "webView",
  .incrementArrow: "incrementArrow", .decrementArrow: "decrementArrow", .timeline: "timeline",
  .ratingIndicator: "ratingIndicator", .valueIndicator: "valueIndicator",
  .splitGroup: "splitGroup", .splitter: "splitter", .relevanceIndicator: "relevanceIndicator",
  .colorWell: "colorWell", .helpTag: "helpTag", .matte: "matte", .dockItem: "dockItem",
  .ruler: "ruler", .rulerMarker: "rulerMarker", .grid: "grid", .levelIndicator: "levelIndicator",
  .cell: "cell", .layoutArea: "layoutArea", .layoutItem: "layoutItem", .handle: "handle",
  .stepper: "stepper", .tab: "tab", .touchBar: "touchBar", .statusItem: "statusItem",
]

func typeName(_ type: XCUIElement.ElementType) -> String {
  typeNames[type] ?? "other"
}
