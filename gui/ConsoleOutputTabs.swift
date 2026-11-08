import SwiftUI

/// Keep tab geometry independent of the AppKit segmented control's intrinsic
/// size, which can change during console updates and animated panel layout.
struct ConsoleOutputTabs: View {
    @Binding var selection: Int
    @FocusState private var focusedTab: Int?
    private let labels = ["All", "Host", "USB & typing", "Pipeline", "Acquisition"]

    var body: some View {
        HStack(spacing: 2) {
            ForEach(labels.indices, id: \.self) { index in
                Button { selection = index; focusedTab = index } label: {
                    Text(labels[index])
                        .font(.system(size: 11, weight: selection == index ? .semibold : .medium))
                        .lineLimit(1).minimumScaleFactor(0.85)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .padding(.horizontal, 4)
                        .foregroundStyle(selection == index ? Mac2jbTheme.background : Mac2jbTheme.muted)
                        .background(selection == index ? Mac2jbTheme.mist : .clear,
                                    in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .focusable()
                .focused($focusedTab, equals: index)
                .accessibilityLabel(labels[index] + " console output")
                .accessibilityAddTraits(selection == index ? [.isSelected] : [])
                .onMoveCommand { direction in
                    let next: Int
                    switch direction {
                    case .left: next = max(0, index - 1)
                    case .right: next = min(labels.count - 1, index + 1)
                    default: return
                    }
                    selection = next
                    focusedTab = next
                }
            }
        }
        .padding(3)
        .frame(height: 28)
        .background(.white.opacity(0.045), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous)
            .strokeBorder(.white.opacity(0.055), lineWidth: 0.75))
        .clipped()
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Console output")
        .transaction { $0.animation = nil }
    }
}
