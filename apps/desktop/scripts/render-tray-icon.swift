// Rasterizes tray-icon-template.svg to tray-icon-template.png with true alpha
// transparency, for the macOS menu bar template icon (see setup_tray in
// src-tauri/src/window_behavior.rs). `qlmanage -t` looks like it preserves
// transparency (`sips -g hasAlpha` reports true) but actually flattens the
// SVG onto an opaque white background — every pixel ends up alpha=255, so
// the "icon" renders as a plain white square. Drawing into an explicitly
// cleared NSBitmapImageRep avoids that.
//
// Run after editing the SVG (macOS only, no cross-platform equivalent here):
//   swift apps/desktop/scripts/render-tray-icon.swift
import AppKit

let scriptDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
let iconsDir = scriptDir
    .deletingLastPathComponent()
    .appendingPathComponent("src-tauri")
    .appendingPathComponent("icons")
let svgPath = iconsDir.appendingPathComponent("tray-icon-template.svg").path
let outPath = iconsDir.appendingPathComponent("tray-icon-template.png").path
let size = 128

guard let image = NSImage(contentsOfFile: svgPath) else {
    print("Could not load \(svgPath)")
    exit(1)
}
guard let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: size,
    pixelsHigh: size,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
) else {
    print("Could not allocate bitmap")
    exit(1)
}

let targetSize = NSSize(width: size, height: size)
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
NSGraphicsContext.current?.cgContext.clear(CGRect(origin: .zero, size: targetSize))
image.draw(in: NSRect(origin: .zero, size: targetSize), from: .zero, operation: .sourceOver, fraction: 1.0)
NSGraphicsContext.restoreGraphicsState()

guard let data = rep.representation(using: .png, properties: [:]) else {
    print("Could not encode PNG")
    exit(1)
}
try! data.write(to: URL(fileURLWithPath: outPath))
print("Wrote \(outPath)")
