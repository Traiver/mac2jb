import AppKit
import SwiftUI

// Renders mac2jb's original app-icon face geometry at the standard macOS
// iconset sizes. Uses no SF Symbol artwork or third-party image assets.
@main
struct MakeAppIcon {
    static func main() throws {
        guard CommandLine.arguments.count == 3 else {
            throw NSError(domain: "mac2jb.icon", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "usage: make-app-icon output.iconset output.icns"])
        }
        let folder = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        let output = URL(fileURLWithPath: CommandLine.arguments[2])
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let appearance = NSAppearance(named: .aqua)!
        let variants = [(16, 1), (16, 2), (32, 1), (32, 2), (128, 1),
                        (128, 2), (256, 1), (256, 2), (512, 1), (512, 2)]
        for (points, scale) in variants {
            let pixels = points * scale
            let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels,
                pixelsHigh: pixels, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
            let graphics = NSGraphicsContext(bitmapImageRep: bitmap)!
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = graphics
            appearance.performAsCurrentDrawingAppearance {
                let context = graphics.cgContext
                context.scaleBy(x: CGFloat(pixels) / 1024, y: CGFloat(pixels) / 1024)
                context.translateBy(x: 0, y: 1024)
                context.scaleBy(x: 1, y: -1)
                context.setAllowsAntialiasing(true)
                context.setShouldAntialias(true)
                func color(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ a: CGFloat = 1) -> CGColor {
                    NSColor(srgbRed: r, green: g, blue: b, alpha: a).cgColor
                }
                let tile = CGPath(roundedRect: CGRect(x: 100, y: 100, width: 824, height: 824),
                                  cornerWidth: 184, cornerHeight: 184, transform: nil)
                context.setShadow(offset: CGSize(width: 0, height: 18), blur: 32,
                                  color: color(0.03, 0.09, 0.18, 0.32))
                context.addPath(tile); context.setFillColor(color(0.42, 0.64, 0.85)); context.fillPath()
                context.setShadow(offset: .zero, blur: 0, color: nil)
                context.saveGState(); context.addPath(tile); context.clip()
                let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
                    colors: [color(0.82, 0.91, 0.99), color(0.52, 0.72, 0.91), color(0.32, 0.52, 0.76)] as CFArray,
                    locations: [0, 0.48, 1])!
                context.drawLinearGradient(gradient, start: CGPoint(x: 200, y: 100),
                                           end: CGPoint(x: 830, y: 960), options: [])
                let reflection = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
                    colors: [color(1, 1, 1, 0.62), color(1, 1, 1, 0)] as CFArray,
                    locations: [0, 1])!
                context.drawRadialGradient(reflection, startCenter: CGPoint(x: 285, y: 120), startRadius: 0,
                                           endCenter: CGPoint(x: 285, y: 120), endRadius: 650, options: [])
                context.restoreGState()
                context.addPath(tile); context.setStrokeColor(color(0.94, 0.98, 1, 0.8)); context.setLineWidth(4); context.strokePath()
                let inset = CGPath(roundedRect: CGRect(x: 109, y: 109, width: 806, height: 806),
                                   cornerWidth: 175, cornerHeight: 175, transform: nil)
                context.addPath(inset); context.setStrokeColor(color(0.21, 0.40, 0.64, 0.25)); context.setLineWidth(2); context.strokePath()
                context.setShadow(offset: CGSize(width: 0, height: 3), blur: 6, color: color(1, 1, 1, 0.48))
                context.setFillColor(color(0.08, 0.18, 0.31))
                context.addPath(KeyboardMark().path(in: CGRect(x: 208, y: 232, width: 608, height: 486.4)).cgPath)
                context.fillPath()
                context.setShadow(offset: .zero, blur: 0, color: nil)
            }
            NSGraphicsContext.restoreGraphicsState()
            guard let data = bitmap.representation(using: .png, properties: [:]) else {
                throw NSError(domain: "mac2jb.icon", code: 3,
                              userInfo: [NSLocalizedDescriptionKey: "Unable to encode the app icon."])
            }
            let suffix = scale == 2 ? "@2x" : ""
            try data.write(to: folder.appendingPathComponent("icon_\(points)x\(points)\(suffix).png"))
        }
        let converter = Process()
        converter.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
        converter.arguments = ["-c", "icns", folder.path, "-o", output.path]
        let messages = Pipe()
        converter.standardOutput = messages
        converter.standardError = messages
        try converter.run()
        _ = messages.fileHandleForReading.readDataToEndOfFile()
        converter.waitUntilExit()
        if converter.terminationStatus != 0 {
            // Restricted builders can lack iconutil's image-encoding service.
            // An ICNS file is a length-prefixed container; these are the same
            // standard PNG representations, without a second image conversion.
            let entries = [("icp4", "icon_16x16.png"), ("icp5", "icon_32x32.png"),
                           ("icp6", "icon_32x32@2x.png"), ("ic07", "icon_128x128.png"),
                           ("ic08", "icon_256x256.png"), ("ic09", "icon_512x512.png"),
                           ("ic10", "icon_512x512@2x.png"), ("ic11", "icon_16x16@2x.png"),
                           ("ic12", "icon_32x32@2x.png"), ("ic13", "icon_128x128@2x.png"),
                           ("ic14", "icon_256x256@2x.png")]
            var records = Data()
            for (kind, filename) in entries {
                let png = try Data(contentsOf: folder.appendingPathComponent(filename))
                records.append(contentsOf: kind.utf8)
                appendLength(UInt32(png.count + 8), to: &records)
                records.append(png)
            }
            var container = Data("icns".utf8)
            appendLength(UInt32(records.count + 8), to: &container)
            container.append(records)
            try container.write(to: output)
            print("Packed standard PNG ICNS representations (iconutil encoder unavailable).")
        }
        guard NSImage(contentsOf: output) != nil else {
            throw NSError(domain: "mac2jb.icon", code: 4,
                          userInfo: [NSLocalizedDescriptionKey: "The generated app icon could not be read by AppKit."])
        }
        print("Created mac2jb app icon: \(output.path)")
    }

    private static func appendLength(_ length: UInt32, to data: inout Data) {
        var value = length.bigEndian
        withUnsafeBytes(of: &value) { data.append(contentsOf: $0) }
    }
}
