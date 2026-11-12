import SwiftUI
import Combine

/// Pointer samples affect only the decorative Canvas. Foreground views are never
/// passed through a shader, transformed, blurred or used as a mist texture.
@MainActor final class Mac2jbMistMotion: ObservableObject {
    struct Touch {
        let location: CGPoint
        let direction: CGVector
        let born: Date
    }

    static let lifetime: TimeInterval = 3.2
    @Published private(set) var isAnimating = false
    private(set) var touches: [Touch] = []
    private var lastLocation: CGPoint?
    private var lastSample = Date.distantPast
    private var stopWork: DispatchWorkItem?

    func move(to point: CGPoint, in size: CGSize) {
        guard size.width > 0, size.height > 0,
              point.x.isFinite, point.y.isFinite else { return }
        let now = Date()
        let distance = lastLocation.map { hypot(point.x - $0.x, point.y - $0.y) } ?? .infinity
        guard now.timeIntervalSince(lastSample) >= 1.0 / 30.0, distance >= 10 else { return }
        let direction = lastLocation.map {
            CGVector(dx: (point.x - $0.x) / max(distance, 1), dy: (point.y - $0.y) / max(distance, 1))
        } ?? CGVector(dx: 0, dy: -0.2)
        lastLocation = point
        lastSample = now
        touches.removeAll { now.timeIntervalSince($0.born) >= Self.lifetime }
        if touches.count >= 14 { touches.removeFirst(touches.count - 13) }
        touches.append(Touch(location: CGPoint(x: point.x / size.width, y: point.y / size.height),
                             direction: direction, born: now))
        if !isAnimating { isAnimating = true }
        stopWork?.cancel()
        let stop = DispatchWorkItem { [weak self] in self?.clear() }
        stopWork = stop
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.lifetime, execute: stop)
    }

    func leave() { lastLocation = nil }

    func clear() {
        stopWork?.cancel()
        stopWork = nil
        touches.removeAll(keepingCapacity: true)
        lastLocation = nil
        isAnimating = false
    }
}

struct Mac2jbWorkspace<Content: View>: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var mist = Mac2jbMistMotion()
    private let content: Content

    init(@ViewBuilder content: () -> Content) { self.content = content() }

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Mac2jbBackdrop()
                if !reduceMotion && !reduceTransparency {
                    TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: !mist.isAnimating)) { timeline in
                        Canvas { context, size in
                            drawMist(in: &context, size: size, date: timeline.date)
                        }
                    }
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
                }
                content
            }
            .contentShape(Rectangle())
            .onContinuousHover { phase in
                guard !reduceMotion, !reduceTransparency, scenePhase == .active else { return }
                switch phase {
                case .active(let location): mist.move(to: location, in: geometry.size)
                case .ended: mist.leave()
                }
            }
        }
        .onChange(of: reduceMotion) { _, _ in mist.clear() }
        .onChange(of: reduceTransparency) { _, _ in mist.clear() }
        .onChange(of: scenePhase) { _, phase in if phase != .active { mist.clear() } }
        .onDisappear { mist.clear() }
    }

    private func drawMist(in context: inout GraphicsContext, size: CGSize, date: Date) {
        context.blendMode = .screen
        context.addFilter(.blur(radius: 18))
        for touch in mist.touches {
            let age = date.timeIntervalSince(touch.born)
            guard age >= 0, age < Mac2jbMistMotion.lifetime else { continue }
            let fade = min(age / 0.18, 1) * pow(1 - age / Mac2jbMistMotion.lifetime, 2)
            let center = CGPoint(x: touch.location.x * size.width + touch.direction.dx * age * 23,
                                 y: touch.location.y * size.height + touch.direction.dy * age * 18 - age * 10)
            for wisp in 0..<2 {
                let offset = Double(wisp)
                let width = 170 + age * 64 + offset * 30
                let height = 64 + age * 30
                let origin = CGPoint(x: center.x + sin(age * 1.4 + offset * 2) * 20,
                                     y: center.y + cos(age + offset) * 12)
                var layer = context
                layer.translateBy(x: origin.x, y: origin.y)
                layer.scaleBy(x: 1, y: height / width)
                let radius = width / 2
                layer.fill(Path(ellipseIn: CGRect(x: -radius, y: -radius, width: width, height: width)),
                           with: .radialGradient(Gradient(colors: [Mac2jbTheme.mist.opacity(0.055 * fade), .clear]),
                                                 center: .zero, startRadius: 0, endRadius: radius))
            }
        }
    }
}
