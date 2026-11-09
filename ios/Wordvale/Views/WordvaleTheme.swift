import SwiftUI
import UIKit

enum WordvaleTheme {
    static let paper = adaptive(light: 0xFAF8F3, dark: 0x151C19)
    static let surface = adaptive(light: 0xFFFFFF, dark: 0x202A25)
    static let soft = adaptive(light: 0xEDF1E9, dark: 0x29382F)
    static let ink = adaptive(light: 0x253D3B, dark: 0xE7EEE6)
    static let secondary = adaptive(light: 0x596B62, dark: 0xB3C2B6)
    static let accent = adaptive(light: 0x426C59, dark: 0xAACDB5)
    static let onAccent = adaptive(light: 0xFFFFFF, dark: 0x17271B)
    static let danger = adaptive(light: 0xB13F3E, dark: 0xF0AAA4)

    private static func adaptive(light: UInt, dark: UInt) -> Color {
        Color(uiColor: UIColor { traits in
            let rgb = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: CGFloat((rgb >> 16) & 255) / 255,
                           green: CGFloat((rgb >> 8) & 255) / 255,
                           blue: CGFloat(rgb & 255) / 255, alpha: 1)
        })
    }
}

/// The same continuous line mark used by the desktop recorder.
struct WordvaleMark: Shape {
    func path(in rect: CGRect) -> Path {
        let scale = min(rect.width, rect.height) / 24
        let origin = CGPoint(x: rect.midX - 12 * scale, y: rect.midY - 12 * scale)
        func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: origin.x + x * scale, y: origin.y + y * scale)
        }
        var path = Path()
        path.move(to: point(2, 13))
        path.addCurve(to: point(4, 11), control1: point(3.105, 13), control2: point(4, 12.105))
        path.addLine(to: point(4, 7))
        path.addCurve(to: point(8, 7), control1: point(4, 4.33), control2: point(8, 4.33))
        path.addLine(to: point(8, 20))
        path.addCurve(to: point(12, 20), control1: point(8, 22.67), control2: point(12, 22.67))
        path.addLine(to: point(12, 4))
        path.addCurve(to: point(16, 4), control1: point(12, 1.33), control2: point(16, 1.33))
        path.addLine(to: point(16, 17))
        path.addCurve(to: point(20, 17), control1: point(16, 19.67), control2: point(20, 19.67))
        path.addLine(to: point(20, 13))
        path.addCurve(to: point(22, 11), control1: point(20, 11.895), control2: point(20.895, 11))
        return path
    }
}

struct PrivacyNote: View {
    var body: some View {
        Label("Transcribed on your iPhone", systemImage: "lock.shield")
            .font(.footnote)
            .foregroundStyle(WordvaleTheme.secondary)
    }
}

extension TimeInterval {
    var wordvaleTime: String {
        guard isFinite, self >= 0 else { return "0:00" }
        let total = Int(self)
        if total >= 3_600 {
            return String(format: "%d:%02d:%02d", total / 3_600, (total % 3_600) / 60, total % 60)
        }
        return String(format: "%d:%02d", total / 60, total % 60)
    }
}

struct ActivitySheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
