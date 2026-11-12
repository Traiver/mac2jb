import SwiftUI

enum Mac2jbTheme {
    static let background = Color(red: 0.032, green: 0.048, blue: 0.073)
    static let ink = Color(red: 0.91, green: 0.96, blue: 1.0)
    static let mist = Color(red: 0.62, green: 0.80, blue: 0.96)
    static let muted = Color(red: 0.64, green: 0.73, blue: 0.84)
}

struct Mac2jbBackdrop: View {
    var body: some View {
        ZStack {
            Mac2jbTheme.background
            RadialGradient(colors: [Mac2jbTheme.mist.opacity(0.12), .clear],
                           center: UnitPoint(x: 0.12, y: -0.12), startRadius: 0, endRadius: 700)
            RadialGradient(colors: [Color(red: 0.21, green: 0.41, blue: 0.65).opacity(0.12), .clear],
                           center: .bottomTrailing, startRadius: 0, endRadius: 600)
        }.ignoresSafeArea()
    }
}

/// Use the system's Liquid Glass on current macOS; keep the macOS 14 fallback.
struct MistGlassSurface: ViewModifier {
    var radius: CGFloat = 22
    var interactive = false
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @ViewBuilder func body(content: Content) -> some View {
        if reduceTransparency {
            content.background(Color(red: 0.075, green: 0.11, blue: 0.17),
                               in: RoundedRectangle(cornerRadius: radius, style: .continuous))
        } else if #available(macOS 26.0, *) {
            content.glassEffect(.regular.tint(Mac2jbTheme.mist.opacity(0.035)).interactive(interactive),
                                in: RoundedRectangle(cornerRadius: radius, style: .continuous))
        } else {
            content.background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .strokeBorder(.white.opacity(0.09), lineWidth: 0.75))
        }
    }
}

struct GlassPanel: ViewModifier {
    var padding: CGFloat = 22
    func body(content: Content) -> some View {
        content.padding(padding).frame(maxWidth: .infinity, alignment: .leading)
            .modifier(MistGlassSurface())
            .shadow(color: .black.opacity(0.12), radius: 18, y: 7)
    }
}

/// Interpolate the height used by layout, so surrounding views move with the
/// expansion rather than jumping to their final positions ahead of its drawing.
struct AnimatedExpansionLayout: AnimatableModifier {
    var height: CGFloat

    init(height: CGFloat) {
        self.height = height.isFinite ? max(0, height) : 0
    }

    var animatableData: CGFloat {
        get { height }
        set { height = newValue }
    }

    func body(content: Content) -> some View {
        content
            .frame(height: height.isFinite ? max(0, height) : 0, alignment: .top)
            .clipped()
    }
}

struct PrimaryActionStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    var large = false
    var secondary = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: large ? 13 : 12, weight: .semibold))
            .foregroundStyle(enabled ? secondary ? Mac2jbTheme.ink : Mac2jbTheme.background : Mac2jbTheme.muted)
            .frame(minWidth: large ? 0 : 120, minHeight: large ? 46 : 36)
            .frame(maxWidth: large ? .infinity : nil)
            .padding(.horizontal, large ? 18 : 15)
            .background(enabled ? secondary ? .white.opacity(configuration.isPressed ? 0.12 : 0.065) : Mac2jbTheme.mist.opacity(configuration.isPressed ? 0.76 : 1) : .white.opacity(0.07),
                        in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(.white.opacity(enabled ? 0.19 : 0.04), lineWidth: 0.75))
            .shadow(color: Mac2jbTheme.mist.opacity(enabled && !secondary ? 0.08 : 0), radius: 12, y: 4)
    }
}
