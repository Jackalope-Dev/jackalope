import AppKit
import ApplicationServices
import Foundation
import ScreenCaptureKit

struct ControlError: Error, CustomStringConvertible {
    let description: String
    init(_ message: String) { description = message }
}

func require(_ condition: Bool, _ message: String) throws {
    if !condition { throw ControlError(message) }
}

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
    return value
}

func elementAttribute(_ element: AXUIElement, _ name: String) -> AXUIElement? {
    guard let value = attribute(element, name), CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return (value as! AXUIElement)
}

func axBounds(_ element: AXUIElement) -> CGRect? {
    guard let position = attribute(element, kAXPositionAttribute),
          let size = attribute(element, kAXSizeAttribute),
          CFGetTypeID(position) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero
    var dimensions = CGSize.zero
    guard AXValueGetValue(position as! AXValue, .cgPoint, &point),
          AXValueGetValue(size as! AXValue, .cgSize, &dimensions) else { return nil }
    return CGRect(origin: point, size: dimensions)
}

func sameBounds(_ a: CGRect, _ b: CGRect) -> Bool {
    abs(a.minX - b.minX) < 1 && abs(a.minY - b.minY) < 1 &&
        abs(a.width - b.width) < 1 && abs(a.height - b.height) < 1
}

func boundsJSON(_ rect: CGRect) -> [String: Double] {
    ["x": rect.minX, "y": rect.minY, "width": rect.width, "height": rect.height]
}

func rectFromJSON(_ value: Any?) throws -> CGRect {
    guard let fields = value as? [String: Double], let x = fields["x"], let y = fields["y"],
          let width = fields["width"], let height = fields["height"],
          [x, y, width, height].allSatisfy({ $0.isFinite }), width > 0, height > 0 else {
        throw ControlError("Invalid selected-window bounds. Take a fresh snapshot.")
    }
    return CGRect(x: x, y: y, width: width, height: height)
}

func started(_ pid: pid_t) -> String? {
    var buffer = [CChar](repeating: 0, count: 64)
    guard jackalope_process_start(pid, &buffer, 64) != 0 else { return nil }
    return String(cString: buffer)
}

func visibleWindows() -> [[String: Any]] {
    (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
        as? [[String: Any]]) ?? []
}

struct SelectedWindow {
    let id: CGWindowID
    let pid: pid_t
    let start: String
    let bundle: String
    let title: String

    init(_ json: [String: Any]) throws {
        guard let handle = json["handle"] as? String, let id = UInt32(handle),
              let pid = json["pid"] as? Int32, let start = json["started"] as? String,
              let bundle = json["class"] as? String, let title = json["title"] as? String else {
            throw ControlError("Invalid window identity.")
        }
        self.id = id; self.pid = pid; self.start = start; self.bundle = bundle; self.title = title
    }

    func bounds() throws -> CGRect {
        try require(started(pid) == start && NSRunningApplication(processIdentifier: pid)?.bundleIdentifier == bundle,
                    "The selected process has ended or changed. Request access again.")
        guard let window = visibleWindows().first(where: { ($0[kCGWindowNumber as String] as? UInt32) == id }),
              (window[kCGWindowOwnerPID as String] as? Int32) == pid,
              (window[kCGWindowLayer as String] as? Int) == 0,
              let dictionary = window[kCGWindowBounds as String] as? [String: Any],
              let rect = CGRect(dictionaryRepresentation: dictionary as CFDictionary), rect.width > 0, rect.height > 0 else {
            throw ControlError("The selected window is hidden, minimized, closed or replaced.")
        }
        return rect
    }

    func accessible(_ bounds: CGRect) throws -> AXUIElement {
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app, 0.4)
        guard let windows = attribute(app, kAXWindowsAttribute) as? [AXUIElement] else {
            throw ControlError("The selected app does not expose accessible windows.")
        }
        let matches = windows.filter { axBounds($0).map { sameBounds($0, bounds) } ?? false }
        try require(matches.count == 1, "The selected window cannot be identified unambiguously through Accessibility.")
        return matches[0]
    }

    func isForeground(_ bounds: CGRect) -> Bool {
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid,
              let window = try? accessible(bounds),
              let focused = elementAttribute(AXUIElementCreateApplication(pid), kAXFocusedWindowAttribute) else { return false }
        return CFEqual(focused, window)
    }

    func foreground(_ bounds: CGRect) throws -> AXUIElement {
        try require(NSWorkspace.shared.frontmostApplication?.processIdentifier == pid, "The selected app lost focus. Wait for the human to Resume.")
        let window = try accessible(bounds)
        guard let focused = elementAttribute(AXUIElementCreateApplication(pid), kAXFocusedWindowAttribute),
              CFEqual(focused, window) else { throw ControlError("Another window or dialog has focus.") }
        return window
    }

    func focus() throws {
        let rect = try bounds()
        let window = try accessible(rect)
        try require(NSRunningApplication(processIdentifier: pid)?.activate(options: [.activateIgnoringOtherApps]) == true,
                    "macOS refused to activate the selected app.")
        try require(AXUIElementPerformAction(window, kAXRaiseAction as CFString) == .success, "macOS refused to raise the selected window.")
        _ = AXUIElementSetAttributeValue(window, kAXMainAttribute as CFString, kCFBooleanTrue)
    }
}

func permissions() -> [String: Any] {
    ["accessibility": AXIsProcessTrusted(), "screenRecording": CGPreflightScreenCaptureAccess(),
     "inputMonitoring": CGPreflightListenEventAccess()]
}

func checkPermissions() throws {
    try require(AXIsProcessTrusted(), "Allow Jackalope Accessibility access in System Settings, then restart it.")
    try require(CGPreflightScreenCaptureAccess(), "Allow Jackalope Screen Recording access in System Settings, then restart it.")
    try require(CGPreflightListenEventAccess(), "Allow Jackalope Input Monitoring in System Settings, then restart it.")
}

func heldInput() -> Bool {
    let flags = CGEventSource.flagsState(.combinedSessionState)
    if !flags.intersection([.maskShift, .maskControl, .maskAlternate, .maskCommand, .maskSecondaryFn]).isEmpty { return true }
    if jackalope_mouse_buttons_down() != 0 { return true }
    for key in 0..<128 {
        if CGEventSource.keyState(.combinedSessionState, key: CGKeyCode(key)) { return true }
    }
    return false
}

struct Guard {
    let file: URL
    let epoch: UInt64
    let tag: Int64
    let indicator: pid_t
    init(_ json: [String: Any]) throws {
        guard let file = json["file"] as? String, let epoch = json["epoch"] as? UInt64 else { throw ControlError("Missing desktop guard.") }
        self.file = URL(fileURLWithPath: file); self.epoch = epoch
        guard let tag = Int64(try String(contentsOf: self.file.deletingLastPathComponent().appendingPathComponent("tag"), encoding: .utf8)) else {
            throw ControlError("Desktop input tag is unavailable.")
        }
        self.tag = tag
        indicator = try Guard.check(self.file, epoch)
    }
    static func check(_ file: URL, _ epoch: UInt64) throws -> pid_t {
        let fields = try String(contentsOf: file, encoding: .utf8).components(separatedBy: "|")
        guard fields.count == 6, fields[0] == "active", UInt64(fields[1]) == epoch,
              let heartbeat = Double(fields[2]), let pid = Int32(fields[3]), started(pid) == fields[4] else {
            throw ControlError("Desktop control paused, changed or ended. Wait for the human to Resume.")
        }
        let age = Date().timeIntervalSince1970 * 1000 - heartbeat
        try require(age >= 0 && age <= 3000, "Desktop indicator stopped responding.")
        return pid
    }
    func check() throws { _ = try Guard.check(file, epoch) }
    func post(_ event: CGEvent) throws {
        try check()
        event.setIntegerValueField(.eventSourceUserData, value: tag)
        event.post(tap: .cghidEventTap)
    }
    func release(_ event: CGEvent) {
        event.setIntegerValueField(.eventSourceUserData, value: tag)
        event.post(tap: .cghidEventTap)
    }
}

func secure(_ element: AXUIElement) -> Bool {
    (attribute(element, kAXSubroleAttribute) as? String) == kAXSecureTextFieldSubrole
}

func focusedElement(_ window: SelectedWindow, _ rect: CGRect) throws -> AXUIElement {
    _ = try window.foreground(rect)
    guard let focused = elementAttribute(AXUIElementCreateApplication(window.pid), kAXFocusedUIElementAttribute),
          let owner = elementAttribute(focused, kAXWindowAttribute),
          CFEqual(owner, try window.accessible(rect)) else {
        throw ControlError("The focused control cannot be verified inside the selected window.")
    }
    var ancestor: AXUIElement? = focused
    for _ in 0..<24 {
        guard let element = ancestor else { break }
        try require(!secure(element), "Typing and keypresses are blocked in password controls.")
        ancestor = elementAttribute(element, kAXParentAttribute)
    }
    return focused
}

// Element refs survive across snapshots while the resident helper runs, so the
// same control keeps its ref as long as Accessibility reports the same element.
var refElements: [String: AXUIElement] = [:]
var refIds: [(AXUIElement, Int)] = []
var refWindow: CGWindowID = 0
var nextRef = 0

func refFor(_ element: AXUIElement) -> String {
    if let found = refIds.first(where: { CFEqual($0.0, element) }) { return "e\(found.1)" }
    nextRef += 1
    refIds.append((element, nextRef))
    return "e\(nextRef)"
}

func actionNames(_ element: AXUIElement) -> [String] {
    var names: CFArray?
    guard AXUIElementCopyActionNames(element, &names) == .success, let list = names as? [String] else { return [] }
    return list
}

func settable(_ element: AXUIElement, _ name: String) -> Bool {
    var result: DarwinBoolean = false
    return AXUIElementIsAttributeSettable(element, name as CFString, &result) == .success && result.boolValue
}

func findRole(_ root: AXUIElement, _ role: String, limit: Int) -> AXUIElement? {
    var queue: [AXUIElement] = [root]
    var visited = 0
    while !queue.isEmpty && visited < limit {
        let element = queue.removeFirst()
        visited += 1
        AXUIElementSetMessagingTimeout(element, 0.2)
        if (attribute(element, kAXRoleAttribute) as? String) == role { return element }
        if let children = attribute(element, kAXChildrenAttribute) as? [AXUIElement] { queue.append(contentsOf: children.prefix(100)) }
    }
    return nil
}

// Chromium exposes web content to Accessibility only after a client asks for it.
func enableWebAccessibility(_ pid: pid_t) {
    let app = AXUIElementCreateApplication(pid)
    _ = AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
}

func site(_ window: AXUIElement) -> [String: Any]? {
    if let area = findRole(window, "AXWebArea", limit: 400), let url = attribute(area, "AXURL") {
        if CFGetTypeID(url) == CFURLGetTypeID() { return ["url": (url as! URL).absoluteString, "source": "document"] }
        if let text = url as? String { return ["url": text, "source": "document"] }
    }
    if let document = attribute(window, kAXDocumentAttribute) as? String, !document.isEmpty {
        return ["url": document, "source": "window"]
    }
    return nil
}

func describe(_ element: AXUIElement, _ depth: Int, _ rect: CGRect) -> [String: Any] {
    let password = secure(element)
    var item: [String: Any] = ["ref": refFor(element), "depth": depth, "role": attribute(element, kAXRoleAttribute) as? String ?? "unknown"]
    if let bounds = axBounds(element) {
        let visible = bounds.intersection(rect)
        if !visible.isNull && !visible.isEmpty {
            item["bounds"] = [Int(bounds.minX - rect.minX), Int(bounds.minY - rect.minY), Int(bounds.width), Int(bounds.height)]
        }
    }
    if password {
        item["name"] = "[protected]"
        item["protected"] = true
        return item
    }
    let title = attribute(element, kAXTitleAttribute) as? String ?? ""
    let description = attribute(element, kAXDescriptionAttribute) as? String ?? ""
    item["name"] = String((title.isEmpty ? description : title).prefix(256))
    if !title.isEmpty && !description.isEmpty { item["description"] = String(description.prefix(200)) }
    if let value = attribute(element, kAXValueAttribute) as? String { item["value"] = String(value.prefix(200)) }
    var states: [String] = []
    var actions: [String] = []
    if (attribute(element, kAXEnabledAttribute) as? Bool) == false { states.append("disabled") }
    if (attribute(element, kAXFocusedAttribute) as? Bool) == true { states.append("focused") }
    if (attribute(element, kAXSelectedAttribute) as? Bool) == true { states.append("selected") }
    let names = actionNames(element)
    if names.contains(kAXPressAction as String) { actions.append("invoke") }
    if settable(element, kAXValueAttribute) { actions.append("set_value") }
    if settable(element, kAXSelectedAttribute) { actions.append("select") }
    if !states.isEmpty { item["states"] = states }
    if !actions.isEmpty { item["actions"] = actions }
    return item
}

func snapshot(_ root: AXUIElement, _ rect: CGRect, page: Bool) -> [[String: Any]] {
    var result: [[String: Any]] = []
    let limit = page ? 600 : 300
    let maxDepth = page ? 40 : 14
    let deadline = Date().addingTimeInterval(8)
    refElements = [:]
    if refIds.count > 5000 { refIds = [] }
    func visit(_ element: AXUIElement, _ depth: Int) {
        if depth > maxDepth || result.count >= limit || Date() >= deadline { return }
        AXUIElementSetMessagingTimeout(element, 0.2)
        let item = describe(element, depth, rect)
        if let reference = item["ref"] as? String { refElements[reference] = element }
        result.append(item)
        if item["protected"] == nil, let children = attribute(element, kAXChildrenAttribute) as? [AXUIElement] {
            for child in children.prefix(limit) { visit(child, depth + 1) }
        }
    }
    visit(root, 0)
    return result
}

func referenced(_ request: [String: Any], _ key: String) throws -> AXUIElement {
    guard let reference = request[key] as? String, let element = refElements[reference] else {
        throw ControlError("Unknown element ref. Take a new snapshot.")
    }
    try require(attribute(element, kAXRoleAttribute) != nil, "The element is no longer available. Take a new snapshot.")
    try require(!secure(element), "Password controls are protected. Enter secrets yourself.")
    return element
}

let keyCodes: [String: CGKeyCode] = ["Tab": 48, "Enter": 36, "Escape": 53, "Space": 49, "Backspace": 51,
    "Delete": 117, "Insert": 114, "ArrowUp": 126, "ArrowDown": 125, "ArrowLeft": 123, "ArrowRight": 124,
    "Home": 115, "End": 119, "PageUp": 116, "PageDown": 121,
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12,
    "w": 13, "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23,
    "=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29, "]": 30, "o": 31, "u": 32, "[": 33, "i": 34,
    "p": 35, "l": 37, "j": 38, "'": 39, "k": 40, ";": 41, "\\": 42, ",": 43, "/": 44, "n": 45, "m": 46,
    ".": 47, "`": 50, "F1": 122, "F2": 120, "F3": 99, "F4": 118, "F5": 96, "F6": 97, "F7": 98, "F8": 100,
    "F9": 101, "F10": 109, "F11": 103, "F12": 111]

let modifierFlags: [String: CGEventFlags] = ["Command": .maskCommand, "Control": .maskControl,
    "Shift": .maskShift, "Alt": .maskAlternate]

@available(macOS 14.0, *)
func awaitCapture(_ start: (@escaping (Result<CGImage, Error>) -> Void) -> Void) throws -> CGImage {
    var result: Result<CGImage, Error>?
    start { value in DispatchQueue.main.async { if result == nil { result = value } } }
    let deadline = Date().addingTimeInterval(8)
    while result == nil && Date() < deadline {
        RunLoop.current.run(until: Date().addingTimeInterval(0.01))
    }
    if result == nil { result = .failure(ControlError("Capture timed out.")) }
    return try result!.get()
}

@available(macOS 14.0, *)
func captureModernWindow(_ selected: SelectedWindow, _ rect: CGRect) throws -> CGImage {
    try awaitCapture { finish in
        SCShareableContent.getExcludingDesktopWindows(true, onScreenWindowsOnly: true) { content, error in
            if let error = error { finish(.failure(error)); return }
            guard let window = content?.windows.first(where: {
                $0.windowID == selected.id && $0.owningApplication?.processID == selected.pid
            }), sameBounds(window.frame, rect) else {
                finish(.failure(ControlError("The selected capture window changed or is unavailable.")))
                return
            }
            let configuration = SCStreamConfiguration()
            configuration.width = Int(rect.width)
            configuration.height = Int(rect.height)
            configuration.showsCursor = false
            configuration.ignoreShadowsSingleWindow = true
            configuration.capturesAudio = false
            SCScreenshotManager.captureImage(contentFilter: SCContentFilter(desktopIndependentWindow: window),
                                            configuration: configuration) { image, error in
                if let error = error { finish(.failure(error)) }
                else if let image = image { finish(.success(image)) }
                else { finish(.failure(ControlError("macOS returned no window capture."))) }
            }
        }
    }
}

func captureWindow(_ selected: SelectedWindow, _ rect: CGRect) throws -> CGImage {
    if #available(macOS 14.0, *) { return try captureModernWindow(selected, rect) }
    guard let image = CGWindowListCreateImage(.null, .optionIncludingWindow, selected.id,
                                            [.boundsIgnoreFraming, .nominalResolution]) else {
        throw ControlError("macOS could not capture the selected window.")
    }
    return image
}

func displays() -> [CGDirectDisplayID] {
    var count: UInt32 = 0
    guard CGGetActiveDisplayList(0, nil, &count) == .success, count > 0 else { return [] }
    var list = [CGDirectDisplayID](repeating: 0, count: Int(count))
    guard CGGetActiveDisplayList(count, &list, &count) == .success else { return [] }
    return Array(list.prefix(Int(count)))
}

func monitors() -> [[String: Any]] {
    displays().enumerated().map { index, display in
        let bounds = CGDisplayBounds(display)
        return ["index": index, "primary": CGDisplayIsMain(display) != 0,
                "bounds": [Int(bounds.minX), Int(bounds.minY), Int(bounds.width), Int(bounds.height)]]
    }
}

func monitorBounds(_ request: [String: Any]) throws -> (CGDirectDisplayID, CGRect) {
    let list = displays()
    let index = request["monitor"] as? Int ?? list.firstIndex(where: { CGDisplayIsMain($0) != 0 }) ?? 0
    try require(index >= 0 && index < list.count, "Unknown monitor. List monitors with snapshot first.")
    return (list[index], CGDisplayBounds(list[index]))
}

@available(macOS 14.0, *)
func captureModernDisplay(_ display: CGDirectDisplayID, _ rect: CGRect, excluding indicator: pid_t) throws -> CGImage {
    try awaitCapture { finish in
        SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: true) { content, error in
            if let error = error { finish(.failure(error)); return }
            guard let content = content, let target = content.displays.first(where: { $0.displayID == display }) else {
                finish(.failure(ControlError("The monitor is unavailable.")))
                return
            }
            let excluded = content.windows.filter { $0.owningApplication?.processID == indicator }
            let configuration = SCStreamConfiguration()
            configuration.width = Int(rect.width)
            configuration.height = Int(rect.height)
            configuration.showsCursor = false
            configuration.capturesAudio = false
            SCScreenshotManager.captureImage(contentFilter: SCContentFilter(display: target, excludingWindows: excluded),
                                            configuration: configuration) { image, error in
                if let error = error { finish(.failure(error)) }
                else if let image = image { finish(.success(image)) }
                else { finish(.failure(ControlError("macOS returned no monitor capture."))) }
            }
        }
    }
}

func captureDisplay(_ display: CGDirectDisplayID, _ rect: CGRect, excluding indicator: pid_t) throws -> CGImage {
    if #available(macOS 14.0, *) { return try captureModernDisplay(display, rect, excluding: indicator) }
    guard let image = CGWindowListCreateImage(rect, .optionOnScreenOnly, kCGNullWindowID, [.nominalResolution]) else {
        throw ControlError("macOS could not capture the monitor.")
    }
    return image
}

func scaled(_ image: CGImage, _ width: Int) -> CGImage {
    guard width > 0, image.width > width else { return image }
    let height = max(1, image.height * width / image.width)
    guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return image }
    context.interpolationQuality = .high
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    return context.makeImage() ?? image
}

func writePNG(_ image: CGImage, _ path: String) throws {
    guard let data = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else {
        throw ControlError("macOS could not encode the capture.")
    }
    try require(data.count <= 8 * 1024 * 1024, "Capture exceeds the 8 MiB limit.")
    try data.write(to: URL(fileURLWithPath: path), options: [.withoutOverwriting])
}

func sent(_ method: String, _ focusChanged: Bool, _ note: String) -> [String: Any] {
    ["status": "input_sent", "method": method, "focusChanged": focusChanged, "note": note,
     "instruction": "Take a new snapshot to verify the result. No automatic replay."]
}

/// State for one input request: where it lands and how it may be delivered.
struct Target {
    let window: SelectedWindow?
    let rect: CGRect
    let scope: String
    let deny: Set<pid_t>
    let guardState: Guard
    let source: CGEventSource

    /// Brings the target window forward for mouse or keyboard input. Window
    /// grants never change focus; app and desktop grants may, and report it.
    func ensureForeground() throws -> Bool {
        try require(!heldInput(), "Release keyboard keys and mouse buttons before input.")
        guard let window = window else {
            let front = NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0
            try require(!deny.contains(front), "Jackalope has focus. Switch to another window first.")
            return false
        }
        if window.isForeground(rect) { return false }
        try require(scope != "window", "The selected window lost focus. Wait for the human to Resume.")
        try window.focus()
        let deadline = Date().addingTimeInterval(1)
        while !window.isForeground(rect) && Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.05)) }
        _ = try window.foreground(rect)
        return true
    }

    func absolute(_ x: Double, _ y: Double) throws -> CGPoint {
        try require(x >= 0 && y >= 0 && x < rect.width && y < rect.height, "Point lies outside the captured area.")
        let point = CGPoint(x: rect.minX + x, y: rect.minY + y)
        let hit = visibleWindows().first { window in
            guard (window[kCGWindowAlpha as String] as? Double ?? 1) > 0,
                  let dictionary = window[kCGWindowBounds as String] as? [String: Any],
                  let bounds = CGRect(dictionaryRepresentation: dictionary as CFDictionary) else { return false }
            return bounds.contains(point)
        }
        let owner = hit?[kCGWindowOwnerPID as String] as? Int32 ?? 0
        try require(!deny.contains(owner), "Jackalope's own window is at the target point.")
        if let window = window {
            if scope == "window" { try require((hit?[kCGWindowNumber as String] as? UInt32) == window.id, "Another window covers the target point.") }
            else { try require(owner == window.pid, "Another app covers the target point.") }
        }
        return point
    }

    func center(_ element: AXUIElement) throws -> CGPoint {
        guard let bounds = axBounds(element), bounds.width >= 1, bounds.height >= 1 else {
            throw ControlError("The element has no on-screen bounds. Scroll it into view and take a new snapshot.")
        }
        return try absolute(Double(bounds.midX - rect.minX), Double(bounds.midY - rect.minY))
    }

    func point(_ request: [String: Any], _ elementKey: String, _ xKey: String, _ yKey: String) throws -> CGPoint {
        if request[elementKey] is String { return try center(try referenced(request, elementKey)) }
        guard let x = request[xKey] as? Double, let y = request[yKey] as? Double else { throw ControlError("Missing target point.") }
        return try absolute(x, y)
    }

    func mouse(_ point: CGPoint, right: Bool, count: Int) throws {
        let types: (CGEventType, CGEventType) = right ? (.rightMouseDown, .rightMouseUp) : (.leftMouseDown, .leftMouseUp)
        for click in 1...max(1, count) {
            guard let down = CGEvent(mouseEventSource: source, mouseType: types.0, mouseCursorPosition: point, mouseButton: right ? .right : .left),
                  let up = CGEvent(mouseEventSource: source, mouseType: types.1, mouseCursorPosition: point, mouseButton: right ? .right : .left) else {
                throw ControlError("Cannot create mouse input.")
            }
            down.setIntegerValueField(.mouseEventClickState, value: Int64(click))
            up.setIntegerValueField(.mouseEventClickState, value: Int64(click))
            try guardState.post(down)
            guardState.release(up)
        }
    }

    func keys(_ code: CGKeyCode, _ flags: CGEventFlags) throws {
        guard let down = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: true),
              let up = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false) else { throw ControlError("Cannot create keyboard input.") }
        down.flags = flags; up.flags = flags
        try guardState.post(down)
        guardState.release(up)
    }

    func typeText(_ text: String) throws {
        var chunks: [[UniChar]] = [[]]
        for scalar in text.unicodeScalars {
            let units = Array(String(scalar).utf16)
            if chunks[chunks.count - 1].count + units.count > 20 { chunks.append([]) }
            chunks[chunks.count - 1].append(contentsOf: units)
        }
        for units in chunks {
            if let window = window {
                let current = try window.bounds()
                try require(sameBounds(rect, current), "Window moved or resized during typing. Inspect before continuing.")
                _ = try focusedElement(window, current)
            }
            guard let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true),
                  let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false) else { throw ControlError("Cannot create keyboard input.") }
            units.withUnsafeBufferPointer { buffer in
                down.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: buffer.baseAddress!)
                up.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: buffer.baseAddress!)
            }
            try guardState.post(down)
            guardState.release(up)
        }
    }
}

func invoke(_ element: AXUIElement) throws -> [String: Any] {
    let names = actionNames(element)
    for action in [kAXPressAction as String, kAXConfirmAction as String, kAXPickAction as String] where names.contains(action) {
        try require(AXUIElementPerformAction(element, action as CFString) == .success, "The app refused the accessibility action.")
        return sent("accessibility", false, "Performed \(action) through Accessibility; the mouse did not move.")
    }
    if settable(element, kAXSelectedAttribute) {
        try require(AXUIElementSetAttributeValue(element, kAXSelectedAttribute as CFString, kCFBooleanTrue) == .success, "The app refused selection.")
        return sent("accessibility", false, "Selected through Accessibility; the mouse did not move.")
    }
    throw ControlError("This element has no accessibility action. Use click instead.")
}

func input(_ action: String, _ request: [String: Any], _ target: Target) throws -> [String: Any] {
    switch action {
    case "invoke":
        return try invoke(try referenced(request, "element"))
    case "focus":
        let element = try referenced(request, "element")
        try require(AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue) == .success, "The app refused to focus the element.")
        return sent("accessibility", false, "Focused the element through Accessibility.")
    case "click", "double_click", "right_click":
        if action == "click", request["element"] is String {
            let element = try referenced(request, "element")
            if let result = try? invoke(element) { return result }
            let role = attribute(element, kAXRoleAttribute) as? String ?? ""
            if ["AXTextField", "AXTextArea", "AXComboBox"].contains(role),
               AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue) == .success {
                return sent("accessibility", true, "Focused the text control through Accessibility; keyboard focus moved.")
            }
        }
        let changed = try target.ensureForeground()
        let point = try target.point(request, "element", "x", "y")
        try target.mouse(point, right: action == "right_click", count: action == "double_click" ? 2 : 1)
        return sent("pointer", changed, "Sent mouse input at the target point.")
    case "select":
        let element = try referenced(request, "element")
        if let option = request["text"] as? String, !option.isEmpty {
            var queue: [AXUIElement] = [element]
            var visited = 0
            if actionNames(element).contains(kAXPressAction as String) { _ = AXUIElementPerformAction(element, kAXPressAction as CFString); Thread.sleep(forTimeInterval: 0.2) }
            while !queue.isEmpty && visited < 400 {
                let candidate = queue.removeFirst()
                visited += 1
                let title = attribute(candidate, kAXTitleAttribute) as? String ?? attribute(candidate, kAXValueAttribute) as? String ?? ""
                if title == option && !CFEqual(candidate, element) { return try invoke(candidate) }
                if let children = attribute(candidate, kAXChildrenAttribute) as? [AXUIElement] { queue.append(contentsOf: children.prefix(200)) }
            }
            throw ControlError("No option with that exact name. Take a new snapshot.")
        }
        return try invoke(element)
    case "set_value":
        let element = try referenced(request, "element")
        let text = request["text"] as? String ?? ""
        if settable(element, kAXValueAttribute),
           AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, text as CFString) == .success {
            return sent("accessibility", false, "Replaced the value through Accessibility; no keys were sent.")
        }
        let changed = try target.ensureForeground()
        _ = AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue)
        try target.keys(0, .maskCommand)
        if !text.isEmpty { try target.typeText(text) }
        _ = changed
        return sent("keyboard", true, "The control has no writable value, so Jackalope focused it, selected all and typed.")
    case "scroll":
        guard let count = request["wheel"] as? Int32, count != 0, abs(count) <= 10 else { throw ControlError("Invalid scroll input.") }
        let changed = try target.ensureForeground()
        let point = try target.point(request, "element", "x", "y")
        guard let event = CGEvent(scrollWheelEvent2Source: target.source, units: .line, wheelCount: 1, wheel1: count, wheel2: 0, wheel3: 0) else { throw ControlError("Invalid scroll input.") }
        event.location = point
        try target.guardState.post(event)
        return sent("pointer", changed, "Sent wheel input at the target point.")
    case "drag":
        let changed = try target.ensureForeground()
        let from = try target.point(request, "element", "x", "y")
        let to = try target.point(request, "to_element", "to_x", "to_y")
        guard let down = CGEvent(mouseEventSource: target.source, mouseType: .leftMouseDown, mouseCursorPosition: from, mouseButton: .left),
              let up = CGEvent(mouseEventSource: target.source, mouseType: .leftMouseUp, mouseCursorPosition: to, mouseButton: .left) else { throw ControlError("Cannot create mouse input.") }
        try target.guardState.post(down)
        defer { target.guardState.release(up) }
        for step in 1...10 {
            let point = CGPoint(x: from.x + (to.x - from.x) * CGFloat(step) / 10, y: from.y + (to.y - from.y) * CGFloat(step) / 10)
            guard let move = CGEvent(mouseEventSource: target.source, mouseType: .leftMouseDragged, mouseCursorPosition: point, mouseButton: .left) else { continue }
            try target.guardState.post(move)
            Thread.sleep(forTimeInterval: 0.015)
        }
        return sent("pointer", changed, "Dragged with the mouse; the pointer moved.")
    case "type":
        guard let text = request["text"] as? String, !text.isEmpty, text.unicodeScalars.count <= 1000,
              !text.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else { throw ControlError("Invalid literal text.") }
        var changed = false
        if request["element"] is String {
            _ = AXUIElementSetAttributeValue(try referenced(request, "element"), kAXFocusedAttribute as CFString, kCFBooleanTrue)
            changed = true
        }
        changed = try target.ensureForeground() || changed
        try target.typeText(text)
        return sent("keyboard", changed, "Typed literal text with keyboard input.")
    case "press":
        let changed = try target.ensureForeground()
        if let window = target.window { _ = try focusedElement(window, target.rect) }
        var name = ""
        var flags: CGEventFlags = []
        if let chord = request["chord"] as? [String: Any], let key = chord["key"] as? String {
            name = key
            for modifier in chord["modifiers"] as? [String] ?? [] {
                guard let flag = modifierFlags[modifier] else { throw ControlError("Unsupported modifier.") }
                flags.insert(flag)
            }
        } else {
            guard let key = request["key"] as? String else { throw ControlError("Missing key.") }
            name = key
            if key == "Shift+Tab" { name = "Tab"; flags = .maskShift }
            else if key.hasPrefix("Primary+") || key.hasPrefix("Control+") {
                name = String(key.split(separator: "+").last ?? "")
                flags = key.hasPrefix("Primary+") ? .maskCommand : .maskControl
            }
        }
        guard let code = keyCodes[name] else { throw ControlError("Unsupported key.") }
        try target.keys(code, flags)
        return sent("keyboard", changed, "Sent the key chord to the focused control.")
    default:
        throw ControlError("Unsupported desktop action.")
    }
}

func operation(_ request: [String: Any]) throws -> [String: Any] {
    let action = request["action"] as? String ?? ""
    if action == "permissions" { return permissions() }
    if action == "hello" { return ["protocol": 1] }
    if action == "self_test" {
        try require(started(getpid()) != nil && started(-1) == nil, "Process identity self-test failed.")
        let rect = CGRect(x: -900, y: 100, width: 800, height: 600)
        try require(sameBounds(rect, try rectFromJSON(boundsJSON(rect))), "Window coordinate self-test failed.")
        try require(!sameBounds(rect, rect.offsetBy(dx: 1, dy: 0)), "Moved-window check failed.")
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("jackalope-guard-test-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: directory) }
        try "42".write(to: directory.appendingPathComponent("tag"), atomically: true, encoding: .utf8)
        let file = directory.appendingPathComponent("state")
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let identity = "\(getpid())|\(started(getpid())!)"
        try "active|3|\(now)|\(identity)|".write(to: file, atomically: true, encoding: .utf8)
        _ = try Guard(["file": file.path, "epoch": UInt64(3)])
        for state in ["paused|3|\(now)|\(identity)|", "active|4|\(now)|\(identity)|", "active|3|0|\(identity)|", "active|3|\(now)|1|wrong|"] {
            try state.write(to: file, atomically: true, encoding: .utf8)
            var rejected = false
            do { _ = try Guard(["file": file.path, "epoch": UInt64(3)]) } catch { rejected = true }
            try require(rejected, "Inactive, stale or replaced guard was accepted.")
        }
        let first = AXUIElementCreateApplication(getpid())
        try require(refFor(first) == refFor(first), "Element refs are not stable.")
        try require(keyCodes["F12"] != nil && modifierFlags["Command"] != nil, "Key table is incomplete.")
        return ["status": "passed", "checks": "process identity, coordinates, movement, paused/stale/replaced guards, element refs, keys"]
    }
    if action == "request_permissions" {
        _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
        _ = CGRequestScreenCaptureAccess()
        _ = CGRequestListenEventAccess()
        return permissions()
    }
    try checkPermissions()
    let deny = Set((request["deny"] as? [Int] ?? []).map { pid_t($0) } + [getpid()])
    if action == "list" {
        let windows: [[String: Any]] = visibleWindows().compactMap { value in
            guard (value[kCGWindowLayer as String] as? Int) == 0,
                  let id = value[kCGWindowNumber as String] as? UInt32,
                  let pid = value[kCGWindowOwnerPID as String] as? Int32, !deny.contains(pid),
                  let title = value[kCGWindowName as String] as? String, !title.isEmpty,
                  let start = started(pid), let app = NSRunningApplication(processIdentifier: pid),
                  let bundle = app.bundleIdentifier else { return nil }
            return ["handle": String(id), "pid": pid, "started": start, "title": title, "class": bundle,
                    "app": bundle, "appName": app.localizedName ?? bundle]
        }
        return ["windows": Array(windows.prefix(200)), "monitors": monitors()]
    }
    guard let guardJSON = request["guard"] as? [String: Any] else {
        throw ControlError("An active indicator is required.")
    }
    let guardState = try Guard(guardJSON)
    if action == "clipboard_read" {
        let text = NSPasteboard.general.string(forType: .string) ?? ""
        return ["text": String(text.prefix(20000)), "truncated": text.count > 20000]
    }
    if action == "clipboard_write" {
        NSPasteboard.general.clearContents()
        if let text = request["text"] as? String, !text.isEmpty {
            try require(NSPasteboard.general.setString(text, forType: .string), "macOS refused the clipboard change.")
        }
        return ["status": "written"]
    }
    let scope = request["scope"] as? String ?? "window"
    let screen = (request["surface"] as? String) == "screen"
    var window: SelectedWindow?
    if !screen {
        guard let identity = request["window"] as? [String: Any] else { throw ControlError("A selected window is required.") }
        window = try SelectedWindow(identity)
        try require(!deny.contains(window!.pid), "Jackalope's own windows cannot be controlled.")
    }
    let display: CGDirectDisplayID
    let rect: CGRect
    if let window = window {
        display = 0
        rect = try window.bounds()
    } else {
        let monitor = try monitorBounds(request)
        display = monitor.0
        rect = monitor.1
    }
    if scope == "window", let window = window { _ = try window.foreground(rect) }
    if let expected = request["bounds"] as? [String: Double] {
        try require(sameBounds(rect, try rectFromJSON(expected)), "Window bounds changed. Take a new snapshot.")
    }
    let browser = request["browser"] as? Bool == true
    switch action {
    case "snapshot":
        guard let window = window else {
            return ["bounds": boundsJSON(rect), "elements": [[String: Any]](), "monitors": monitors()]
        }
        if refWindow != window.id { refIds = []; refWindow = window.id }
        if browser { enableWebAccessibility(window.pid) }
        let root = try window.accessible(rect)
        var start = root
        if request["page"] as? Bool == true {
            guard let area = findRole(root, "AXWebArea", limit: 600) else {
                throw ControlError("No web page document was found in this window. Take a full snapshot instead.")
            }
            start = area
        }
        var result: [String: Any] = ["bounds": boundsJSON(rect), "elements": snapshot(start, rect, page: request["page"] as? Bool == true)]
        if browser, let page = site(root) { result["site"] = page }
        return result
    case "screenshot":
        try require(rect.width * rect.height <= 33_000_000, "The capture area is too large.")
        guard let path = request["path"] as? String else { throw ControlError("Missing capture path.") }
        let image: CGImage
        if let window = window {
            image = try captureWindow(window, rect)
            try require(image.width == Int(rect.width) && image.height == Int(rect.height), "Capture dimensions do not match window coordinates.")
        } else {
            image = try captureDisplay(display, rect, excluding: guardState.indicator)
        }
        try guardState.check()
        if let window = window {
            try require(sameBounds(rect, try window.bounds()), "Window moved or resized during capture. Take a new snapshot.")
            if scope == "window" { _ = try window.foreground(rect) }
        }
        try writePNG(scaled(image, request["thumb"] as? Int ?? 0), path)
        var result: [String: Any] = ["bounds": boundsJSON(rect)]
        if browser, let window = window, let root = try? window.accessible(rect), let page = site(root) { result["site"] = page }
        return result
    case "focus":
        if request["element"] is String { break }
        guard let window = window else { throw ControlError("Switch to a window first.") }
        try window.focus()
        return ["status": "focused", "bounds": boundsJSON(rect)]
    default:
        break
    }
    guard let source = CGEventSource(stateID: .privateState) else { throw ControlError("Cannot create input source.") }
    try guardState.check()
    let target = Target(window: window, rect: rect, scope: scope, deny: deny.union([guardState.indicator]), guardState: guardState, source: source)
    return try input(action, request, target)
}

func serve() {
    while let line = readLine(strippingNewline: true) {
        if line.isEmpty { continue }
        var response: [String: Any] = [:]
        var id: Any = NSNull()
        do {
            guard let data = line.data(using: .utf8), data.count <= 256_000,
                  let request = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw ControlError("Invalid desktop helper request.")
            }
            id = request["id"] ?? NSNull()
            response["result"] = try operation(request)
            response["ok"] = true
        } catch {
            response["ok"] = false
            response["error"] = String(String(describing: error).prefix(1200))
        }
        response["id"] = id
        if let output = try? JSONSerialization.data(withJSONObject: response, options: [.sortedKeys]) {
            FileHandle.standardOutput.write(output)
            FileHandle.standardOutput.write(Data([10]))
        }
    }
}

final class Indicator: NSObject {
    let selected: SelectedWindow?
    let scope: String
    let app: String
    let name: String
    let stateFile: URL
    let themeFile: URL
    let tag = Int64.random(in: 1...Int64.max)
    let parent = getppid()
    let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 560, height: 56),
                        styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    let label = NSTextField(labelWithString: "")
    let toggle = NSButton(title: "Resume", target: nil, action: nil)
    var frames: [NSWindow] = []
    var accent = NSColor(srgbRed: 99 / 255, green: 102 / 255, blue: 241 / 255, alpha: 1)
    var status = "paused"
    var reason = "Click Resume to begin"
    var epoch: UInt64 = 1
    var previousBounds: CGRect?
    var tap: CFMachPort?
    var timer: Timer?
    var start = ""
    var resumeTicket: UInt64 = 0

    init(_ request: [String: Any]) throws {
        guard let identity = request["window"] as? [String: Any], let file = request["file"] as? String,
              let theme = request["theme"] as? String else { throw ControlError("Invalid indicator request.") }
        scope = request["scope"] as? String ?? "window"
        app = (request["app"] as? String ?? "").lowercased()
        name = request["label"] as? String ?? ""
        if scope == "desktop" { selected = nil } else { selected = try SelectedWindow(identity) }
        stateFile = URL(fileURLWithPath: file); themeFile = URL(fileURLWithPath: theme)
        super.init()
    }

    var subject: String {
        scope == "desktop" ? "your computer" : scope == "app" ? name : "this window"
    }

    func frontmostAllowed() -> Bool {
        guard let front = NSWorkspace.shared.frontmostApplication else { return false }
        if front.processIdentifier == getpid() { return true }
        return front.bundleIdentifier?.lowercased() == app
    }

    func save() {
        let text = "\(status)|\(epoch)|\(Int64(Date().timeIntervalSince1970 * 1000))|\(getpid())|\(start)|\(reason.replacingOccurrences(of: "|", with: "/"))"
        do { try text.write(to: stateFile, atomically: true, encoding: .utf8) }
        catch { NSApp.terminate(nil) }
        label.stringValue = status == "active" ? "Jackalope controls \(subject) · Esc to cancel" : "Paused · \(reason)"
        toggle.title = status == "active" ? "Pause" : "Resume"
        updateFrames()
    }

    /// Draws the in-control frame around the granted window or screens. Frames
    /// ignore the mouse and are excluded from screen captures.
    func updateFrames() {
        var areas: [NSRect] = []
        if status == "active" {
            let top = NSScreen.screens.first?.frame.maxY ?? 0
            if scope == "window", let rect = try? selected?.bounds() {
                areas = [NSRect(x: rect.minX - 4, y: top - rect.maxY - 4, width: rect.width + 8, height: rect.height + 8)]
            } else if scope == "desktop" {
                areas = NSScreen.screens.map { $0.frame }
            } else if let screen = NSScreen.main {
                areas = [screen.frame]
            }
        }
        while frames.count < areas.count {
            let frame = NSWindow(contentRect: .zero, styleMask: [.borderless], backing: .buffered, defer: false)
            frame.isOpaque = false
            frame.backgroundColor = .clear
            frame.ignoresMouseEvents = true
            frame.hasShadow = false
            frame.level = .statusBar
            frame.sharingType = .none
            frame.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
            frame.contentView?.wantsLayer = true
            frame.contentView?.layer?.borderWidth = 4
            frame.contentView?.layer?.cornerRadius = 8
            frames.append(frame)
        }
        while frames.count > areas.count { frames.removeLast().orderOut(nil) }
        for (frame, area) in zip(frames, areas) {
            if frame.frame != area { frame.setFrame(area, display: true) }
            frame.contentView?.layer?.borderColor = accent.cgColor
            frame.orderFrontRegardless()
        }
    }

    func pause(_ message: String) {
        if status == "active" { status = "paused"; reason = message; epoch += 1; save() }
    }

    @objc func cancel() {
        status = "canceled"; reason = "Canceled by the user"; epoch += 1; save(); NSApp.terminate(nil)
    }

    func activateGrant() throws {
        if scope == "window" { try selected?.focus(); return }
        if scope == "app" && !frontmostAllowed() {
            let running = NSWorkspace.shared.runningApplications.first { $0.bundleIdentifier?.lowercased() == app }
            try require(running?.activate(options: [.activateIgnoringOtherApps]) == true, "Open \(name), then resume")
        }
    }

    func verifyGrant() throws {
        if scope == "window", let selected = selected {
            let bounds = try selected.bounds()
            _ = try selected.foreground(bounds)
            previousBounds = bounds
        } else if scope == "app" {
            try require(frontmostAllowed(), "Bring \(name) forward, then resume")
        }
    }

    @objc func change() {
        if status == "active" { pause("Paused by the user"); return }
        do {
            try checkPermissions()
            guard let tap = tap else { throw ControlError("Input monitor unavailable") }
            CGEvent.tapEnable(tap: tap, enable: true)
            try require(CGEvent.tapIsEnabled(tap: tap), "Input monitor unavailable")
            try require(!heldInput(), "Release keys and mouse buttons")
            try activateGrant()
            resumeTicket += 1
            let ticket = resumeTicket
            // Activation completes asynchronously; input remains paused until focus is verified.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
                guard let self = self, self.status == "paused", self.resumeTicket == ticket else { return }
                do {
                    try checkPermissions()
                    try require(self.tap.map { CGEvent.tapIsEnabled(tap: $0) } == true, "Input monitor unavailable")
                    try self.verifyGrant()
                    try require(!heldInput(), "Release keys and mouse buttons")
                    self.status = "active"; self.reason = ""; self.epoch += 1; self.save()
                } catch { self.reason = String(describing: error); self.save() }
            }
        } catch { reason = String(describing: error); save() }
    }

    func event(_ type: CGEventType, _ event: CGEvent) {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput { resumeTicket += 1; pause("Input monitor interrupted"); return }
        if event.getIntegerValueField(.eventSourceUserData) == tag { return }
        resumeTicket += 1
        if type == .keyDown && event.getIntegerValueField(.keyboardEventKeycode) == 53 { cancel(); return }
        pause("Physical input detected")
    }

    func run() throws {
        try checkPermissions()
        NSApp.setActivationPolicy(.accessory)
        guard let processStart = started(getpid()) else { throw ControlError("Cannot identify indicator process.") }
        start = processStart
        try String(tag).write(to: stateFile.deletingLastPathComponent().appendingPathComponent("tag"), atomically: true, encoding: .utf8)
        let types: [CGEventType] = [.keyDown, .keyUp, .flagsChanged, .mouseMoved, .leftMouseDown, .leftMouseUp,
                                   .rightMouseDown, .rightMouseUp, .otherMouseDown, .otherMouseUp,
                                   .leftMouseDragged, .rightMouseDragged, .otherMouseDragged, .scrollWheel]
        let mask = types.reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << $1.rawValue) }
        tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
            eventsOfInterest: mask, callback: { _, type, event, info in
                if let info = info { Unmanaged<Indicator>.fromOpaque(info).takeUnretainedValue().event(type, event) }
                return Unmanaged.passUnretained(event)
            }, userInfo: Unmanaged.passUnretained(self).toOpaque())
        guard let tap = tap, let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0) else {
            throw ControlError("Cannot monitor physical input. Enable Accessibility and Input Monitoring, then restart.")
        }
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.hidesOnDeactivate = false
        panel.sharingType = .none
        panel.isOpaque = true; panel.backgroundColor = .black
        label.textColor = .white; label.font = .systemFont(ofSize: 12)
        label.frame = NSRect(x: 16, y: 19, width: 342, height: 18)
        label.lineBreakMode = .byTruncatingTail
        toggle.frame = NSRect(x: 368, y: 12, width: 88, height: 32)
        toggle.bezelStyle = .rounded; toggle.target = self; toggle.action = #selector(change)
        let cancelButton = NSButton(title: "Cancel", target: self, action: #selector(cancel))
        cancelButton.frame = NSRect(x: 462, y: 12, width: 82, height: 32); cancelButton.bezelStyle = .rounded
        panel.contentView?.addSubview(label); panel.contentView?.addSubview(toggle); panel.contentView?.addSubview(cancelButton)
        var screen = NSScreen.main
        if let bounds = try selected?.bounds() {
            let top = NSScreen.screens.first?.frame.maxY ?? 0
            let cocoaPoint = NSPoint(x: bounds.midX, y: top - bounds.midY)
            screen = NSScreen.screens.first(where: { $0.frame.contains(cocoaPoint) }) ?? NSScreen.main
        }
        guard let frame = screen?.visibleFrame else { throw ControlError("Selected display is unavailable.") }
        panel.setFrameOrigin(NSPoint(x: frame.midX - 280, y: frame.maxY - 56))
        panel.orderFrontRegardless()
        save()
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            if getppid() != self.parent || !self.panel.isVisible { self.cancel(); return }
            do {
                if self.scope == "window", let selected = self.selected {
                    let rect = try selected.bounds()
                    if self.status == "active" {
                        _ = try selected.foreground(rect)
                        if let previous = self.previousBounds, !sameBounds(rect, previous) { self.pause("Window moved or resized") }
                    }
                } else if self.scope == "app" && self.status == "active" && !self.frontmostAllowed() {
                    self.pause("\(self.name) is no longer active")
                }
                if self.status == "active" && !CGEvent.tapIsEnabled(tap: tap) { self.pause("Input monitor interrupted") }
            } catch { self.pause("Window focus or identity changed") }
            if let color = try? String(contentsOf: self.themeFile, encoding: .utf8), color.count == 7,
               let rgb = UInt32(color.dropFirst(), radix: 16) {
                self.accent = NSColor(srgbRed: Double((rgb >> 16) & 255) / 255,
                    green: Double((rgb >> 8) & 255) / 255, blue: Double(rgb & 255) / 255, alpha: 1)
                self.toggle.contentTintColor = self.accent
            }
            self.save()
        }
        NSApp.run()
        timer?.invalidate()
        CFMachPortInvalidate(tap)
    }
}

do {
    guard let raw = ProcessInfo.processInfo.environment["JACKALOPE_DESKTOP_REQUEST"],
          let data = raw.data(using: .utf8), data.count <= 128_000,
          let request = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw ControlError("Invalid desktop helper request.")
    }
    if request["action"] as? String != "self_test" { _ = NSApplication.shared }
    if request["action"] as? String == "indicator" { try Indicator(request).run() }
    else if request["action"] as? String == "serve" { serve() }
    else {
        let result = try operation(request)
        let output = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
        FileHandle.standardOutput.write(output)
    }
} catch {
    FileHandle.standardError.write(Data(String(describing: error).prefix(1200).utf8))
    exit(1)
}
