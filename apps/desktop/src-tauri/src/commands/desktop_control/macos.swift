import AppKit
import ApplicationServices
import Foundation

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
    NSRunningApplication(processIdentifier: pid)?.launchDate.map { String(Int64($0.timeIntervalSince1970 * 1000)) }
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
              let dictionary = window[kCGWindowBounds as String] as? CFDictionary,
              let rect = CGRect(dictionaryRepresentation: dictionary), rect.width > 0, rect.height > 0 else {
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

    func point(_ request: [String: Any], _ rect: CGRect) throws -> CGPoint {
        guard let x = request["x"] as? Double, let y = request["y"] as? Double,
              x >= 0, y >= 0, x < rect.width, y < rect.height else { throw ControlError("Point lies outside the selected window.") }
        let point = CGPoint(x: rect.minX + x, y: rect.minY + y)
        let hit = visibleWindows().first { window in
            guard (window[kCGWindowAlpha as String] as? Double ?? 1) > 0,
                  let dictionary = window[kCGWindowBounds as String] as? CFDictionary,
                  let bounds = CGRect(dictionaryRepresentation: dictionary) else { return false }
            return bounds.contains(point)
        }
        try require((hit?[kCGWindowNumber as String] as? UInt32) == id, "Another window covers the target point.")
        return point
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
    for button in 0..<5 {
        if CGEventSource.buttonState(.combinedSessionState, button: CGMouseButton(rawValue: UInt32(button))!) { return true }
    }
    for key in 0..<128 {
        if CGEventSource.keyState(.combinedSessionState, key: CGKeyCode(key)) { return true }
    }
    return false
}

struct Guard {
    let file: URL
    let epoch: UInt64
    let tag: Int64
    init(_ json: [String: Any]) throws {
        guard let file = json["file"] as? String, let epoch = json["epoch"] as? UInt64 else { throw ControlError("Missing desktop guard.") }
        self.file = URL(fileURLWithPath: file); self.epoch = epoch
        guard let tag = Int64(try String(contentsOf: self.file.deletingLastPathComponent().appendingPathComponent("tag"), encoding: .utf8)) else {
            throw ControlError("Desktop input tag is unavailable.")
        }
        self.tag = tag
        try check()
    }
    func check() throws {
        let fields = try String(contentsOf: file, encoding: .utf8).components(separatedBy: "|")
        guard fields.count == 6, fields[0] == "active", UInt64(fields[1]) == epoch,
              let heartbeat = Double(fields[2]), let pid = Int32(fields[3]), started(pid) == fields[4] else {
            throw ControlError("Desktop control paused, changed or ended. Wait for the human to Resume.")
        }
        let age = Date().timeIntervalSince1970 * 1000 - heartbeat
        try require(age >= 0 && age <= 3000, "Desktop indicator stopped responding.")
    }
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

func snapshot(_ root: AXUIElement, _ rect: CGRect) -> [[String: Any]] {
    var result: [[String: Any]] = []
    let deadline = Date().addingTimeInterval(8)
    func visit(_ element: AXUIElement, _ depth: Int) {
        if depth > 12 || result.count >= 160 || Date() >= deadline { return }
        AXUIElementSetMessagingTimeout(element, 0.2)
        let password = secure(element)
        var item: [String: Any] = ["depth": depth, "role": attribute(element, kAXRoleAttribute) as? String ?? "unknown", "password": password]
        if password {
            item["name"] = "[redacted password control]"
        } else {
            for (key, ax) in [("name", kAXTitleAttribute), ("description", kAXDescriptionAttribute), ("value", kAXValueAttribute)] {
                if let text = attribute(element, ax) as? String { item[key] = String(text.prefix(200)) }
            }
        }
        if let bounds = axBounds(element) { item["bounds"] = boundsJSON(bounds.offsetBy(dx: -rect.minX, dy: -rect.minY)) }
        result.append(item)
        if !password, let children = attribute(element, kAXChildrenAttribute) as? [AXUIElement] {
            for child in children.prefix(160) { visit(child, depth + 1) }
        }
    }
    visit(root, 0)
    return result
}

let keyCodes: [String: CGKeyCode] = ["Tab": 48, "Enter": 36, "Escape": 53, "Space": 49, "Backspace": 51,
    "Delete": 117, "ArrowUp": 126, "ArrowDown": 125, "ArrowLeft": 123, "ArrowRight": 124,
    "Home": 115, "End": 119, "PageUp": 116, "PageDown": 121, "a": 0, "s": 1, "z": 6, "y": 16]

func operation(_ request: [String: Any]) throws -> [String: Any] {
    let action = request["action"] as? String ?? ""
    if action == "permissions" { return permissions() }
    try checkPermissions()
    if action == "list" {
        let windows: [[String: Any]] = visibleWindows().compactMap { value in
            guard (value[kCGWindowLayer as String] as? Int) == 0,
                  let id = value[kCGWindowNumber as String] as? UInt32,
                  let pid = value[kCGWindowOwnerPID as String] as? Int32, pid != getpid(),
                  let title = value[kCGWindowName as String] as? String, !title.isEmpty,
                  let start = started(pid), let bundle = NSRunningApplication(processIdentifier: pid)?.bundleIdentifier else { return nil }
            return ["handle": String(id), "pid": pid, "started": start, "title": title, "class": bundle]
        }
        return ["windows": Array(windows.prefix(20))]
    }
    guard let identity = request["window"] as? [String: Any], let guardJSON = request["guard"] as? [String: Any] else {
        throw ControlError("A selected window and active indicator are required.")
    }
    let window = try SelectedWindow(identity)
    let guardState = try Guard(guardJSON)
    let rect = try window.bounds()
    let root = try window.foreground(rect)
    if action == "snapshot" { return ["bounds": boundsJSON(rect), "controls": snapshot(root, rect)] }
    if action == "screenshot" {
        try require(rect.width * rect.height <= 20_000_000, "Selected window is too large to capture.")
        guard let path = request["path"] as? String,
              let image = CGWindowListCreateImage(.null, .optionIncludingWindow, window.id, [.boundsIgnoreFraming, .nominalResolution]),
              let data = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else { throw ControlError("macOS could not capture the selected window.") }
        try require(image.width == Int(rect.width) && image.height == Int(rect.height), "Capture dimensions do not match window coordinates.")
        try require(data.count <= 8 * 1024 * 1024, "Window capture exceeds the 8 MiB limit.")
        try guardState.check()
        try data.write(to: URL(fileURLWithPath: path), options: [.withoutOverwriting])
        return ["bounds": boundsJSON(rect)]
    }
    if action == "focus" { try window.focus(); return ["status": "focused"] }
    try require(sameBounds(rect, try rectFromJSON(request["bounds"])), "Window bounds changed. Take a new snapshot.")
    try require(!heldInput(), "Release keyboard keys and mouse buttons before input.")
    try guardState.check()
    guard let source = CGEventSource(stateID: .privateState) else { throw ControlError("Cannot create input source.") }
    switch action {
    case "click", "scroll":
        let point = try window.point(request, rect)
        if action == "click" {
            guard let down = CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left),
                  let up = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left) else { throw ControlError("Cannot create mouse input.") }
            try guardState.post(down)
            guardState.release(up)
        } else {
            guard let count = request["wheel"] as? Int32, count != 0, abs(count) <= 10,
                  let event = CGEvent(scrollWheelEvent2Source: source, units: .line, wheelCount: 1, wheel1: count, wheel2: 0, wheel3: 0) else { throw ControlError("Invalid scroll input.") }
            event.location = point
            try guardState.post(event)
        }
    case "type":
        guard let text = request["text"] as? String, !text.isEmpty, text.unicodeScalars.count <= 1000,
              !text.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else { throw ControlError("Invalid literal text.") }
        for character in text {
            _ = try focusedElement(window, try window.bounds())
            let units = Array(String(character).utf16)
            guard let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true),
                  let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false) else { throw ControlError("Cannot create keyboard input.") }
            units.withUnsafeBufferPointer { buffer in
                down.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: buffer.baseAddress!)
                up.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: buffer.baseAddress!)
            }
            try guardState.post(down)
            guardState.release(up)
        }
    case "press":
        _ = try focusedElement(window, rect)
        guard let key = request["key"] as? String else { throw ControlError("Missing key.") }
        var name = key
        var flags: CGEventFlags = []
        if key == "Shift+Tab" { name = "Tab"; flags = .maskShift }
        else if key.hasPrefix("Primary+") || key.hasPrefix("Control+") {
            name = String(key.split(separator: "+").last ?? "")
            try require(["a", "s", "z", "y"].contains(name), "Unsupported editing shortcut.")
            flags = key.hasPrefix("Primary+") ? .maskCommand : .maskControl
        } else { try require(!["a", "s", "z", "y"].contains(name), "Unsupported key.") }
        guard let code = keyCodes[name], let down = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: true),
              let up = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false) else { throw ControlError("Unsupported key.") }
        down.flags = flags; up.flags = flags
        try guardState.post(down)
        guardState.release(up)
    default: throw ControlError("Unsupported desktop action.")
    }
    return ["status": "sent"]
}

final class Indicator: NSObject {
    let selected: SelectedWindow
    let stateFile: URL
    let themeFile: URL
    let tag = Int64.random(in: 1...Int64.max)
    let parent = getppid()
    let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 560, height: 56),
                        styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    let label = NSTextField(labelWithString: "")
    let toggle = NSButton(title: "Resume", target: nil, action: nil)
    var status = "paused"
    var reason = "Click Resume to begin"
    var epoch: UInt64 = 1
    var previousBounds: CGRect?
    var tap: CFMachPort?
    var timer: Timer?
    var start = ""

    init(_ request: [String: Any]) throws {
        guard let identity = request["window"] as? [String: Any], let file = request["file"] as? String,
              let theme = request["theme"] as? String else { throw ControlError("Invalid indicator request.") }
        selected = try SelectedWindow(identity)
        stateFile = URL(fileURLWithPath: file); themeFile = URL(fileURLWithPath: theme)
        super.init()
    }

    func save() {
        let text = "\(status)|\(epoch)|\(Int64(Date().timeIntervalSince1970 * 1000))|\(getpid())|\(start)|\(reason)"
        do { try text.write(to: stateFile, atomically: true, encoding: .utf8) }
        catch { NSApp.terminate(nil) }
        label.stringValue = status == "active" ? "Jackalope controls this window · Esc to cancel" : "Paused · \(reason)"
        toggle.title = status == "active" ? "Pause" : "Resume"
    }

    func pause(_ message: String) {
        if status == "active" { status = "paused"; reason = message; epoch += 1; save() }
    }

    @objc func cancel() {
        status = "canceled"; reason = "Canceled by the user"; epoch += 1; save(); NSApp.terminate(nil)
    }

    @objc func change() {
        if status == "active" { pause("Paused by the user"); return }
        do {
            try checkPermissions()
            guard let tap = tap else { throw ControlError("Input monitor unavailable") }
            CGEvent.tapEnable(tap: tap, enable: true)
            try require(CGEvent.tapIsEnabled(tap: tap), "Input monitor unavailable")
            try require(!heldInput(), "Release keys and mouse buttons")
            try selected.focus()
            // Activation completes asynchronously; input remains paused until focus is verified.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
                guard let self = self, self.status == "paused" else { return }
                do {
                    let bounds = try self.selected.bounds()
                    _ = try self.selected.foreground(bounds)
                    try require(!heldInput(), "Release keys and mouse buttons")
                    self.previousBounds = bounds; self.status = "active"; self.reason = ""; self.epoch += 1; self.save()
                } catch { self.reason = String(describing: error); self.save() }
            }
        } catch { reason = String(describing: error); save() }
    }

    func event(_ type: CGEventType, _ event: CGEvent) {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput { pause("Input monitor interrupted"); return }
        if event.getIntegerValueField(.eventSourceUserData) == tag { return }
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
        panel.isOpaque = true; panel.backgroundColor = .black
        label.textColor = .white; label.font = .systemFont(ofSize: 12)
        label.frame = NSRect(x: 16, y: 19, width: 342, height: 18)
        label.lineBreakMode = .byTruncatingTail
        toggle.frame = NSRect(x: 368, y: 12, width: 88, height: 32)
        toggle.bezelStyle = .rounded; toggle.target = self; toggle.action = #selector(change)
        let cancel = NSButton(title: "Cancel", target: self, action: #selector(cancel))
        cancel.frame = NSRect(x: 462, y: 12, width: 82, height: 32); cancel.bezelStyle = .rounded
        panel.contentView?.addSubview(label); panel.contentView?.addSubview(toggle); panel.contentView?.addSubview(cancel)
        let bounds = try selected.bounds()
        let top = NSScreen.screens.first?.frame.maxY ?? 0
        let cocoaPoint = NSPoint(x: bounds.midX, y: top - bounds.midY)
        let screen = NSScreen.screens.first(where: { $0.frame.contains(cocoaPoint) }) ?? NSScreen.main
        guard let frame = screen?.visibleFrame else { throw ControlError("Selected display is unavailable.") }
        panel.setFrameOrigin(NSPoint(x: frame.midX - 280, y: frame.maxY - 56))
        panel.orderFrontRegardless()
        save()
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            if getppid() != self.parent || !self.panel.isVisible { self.cancel(); return }
            do {
                let rect = try self.selected.bounds()
                if self.status == "active" {
                    _ = try self.selected.foreground(rect)
                    if !CGEvent.tapIsEnabled(tap: tap) { self.pause("Input monitor interrupted") }
                    if let previous = self.previousBounds, !sameBounds(rect, previous) { self.pause("Window moved or resized") }
                }
            } catch { self.pause("Window focus or identity changed") }
            if let color = try? String(contentsOf: self.themeFile, encoding: .utf8), color.count == 7,
               let rgb = UInt32(color.dropFirst(), radix: 16) {
                self.toggle.contentTintColor = NSColor(srgbRed: Double((rgb >> 16) & 255) / 255,
                    green: Double((rgb >> 8) & 255) / 255, blue: Double(rgb & 255) / 255, alpha: 1)
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
    _ = NSApplication.shared
    if request["action"] as? String == "indicator" { try Indicator(request).run() }
    else {
        let result = try operation(request)
        let output = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
        FileHandle.standardOutput.write(output)
    }
} catch {
    FileHandle.standardError.write(Data(String(describing: error).prefix(1200).utf8))
    exit(1)
}
