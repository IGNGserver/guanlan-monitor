import SwiftUI

public struct MiniLineChartView: View {
    public let title: String
    public let points: [SamplePointDto]
    public let valueFormatter: (Double) -> String
    public var fixedMaxValue: Double? = nil
    public var lineColor: Color = .blue
    
    @State private var selectedPointIndex: Int? = nil
    
    public init(
        title: String,
        points: [SamplePointDto],
        valueFormatter: @escaping (Double) -> String,
        fixedMaxValue: Double? = nil,
        lineColor: Color = .blue
    ) {
        self.title = title
        self.points = points
        self.valueFormatter = valueFormatter
        self.fixedMaxValue = fixedMaxValue
        self.lineColor = lineColor
    }
    
    public var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(title)
                    .font(.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(.secondary)
                Spacer()
                if let idx = selectedPointIndex, points.indices.contains(idx) {
                    let point = points[idx]
                    Text("\(valueFormatter(point.value)) (\(formatTime(point.timestamp)))")
                        .font(.caption2)
                        .fontWeight(.bold)
                        .foregroundStyle(lineColor)
                } else if let last = points.last {
                    Text(valueFormatter(last.value))
                        .font(.caption)
                        .fontWeight(.bold)
                        .foregroundStyle(.primary)
                }
            }
            
            GeometryReader { geometry in
                let width = geometry.size.width
                let height = geometry.size.height
                
                if points.count > 1 {
                    let minVal = points.map(\.value).min() ?? 0
                    let maxVal = fixedMaxValue ?? (points.map(\.value).max() ?? 1)
                    let range = max(maxVal - minVal, 0.00001)
                    
                    ZStack {
                        // Background Grid
                        Path { path in
                            path.move(to: CGPoint(x: 0, y: height / 2))
                            path.addLine(to: CGPoint(x: width, y: height / 2))
                        }
                        .stroke(Color.primary.opacity(0.08), style: StrokeStyle(lineWidth: 1, dash: [4]))
                        
                        // Line and Fill
                        let normalizedPoints: [CGPoint] = points.enumerated().map { idx, pt in
                            let x = width * CGFloat(idx) / CGFloat(points.count - 1)
                            let y = height - (height * CGFloat((pt.value - minVal) / range))
                            return CGPoint(x: x, y: y.isNaN ? height : y)
                        }
                        
                        Path { path in
                            path.move(to: normalizedPoints[0])
                            for pt in normalizedPoints.dropFirst() {
                                path.addLine(to: pt)
                            }
                        }
                        .stroke(lineColor, lineWidth: 2)
                        
                        // Fill Gradient
                        Path { path in
                            path.move(to: CGPoint(x: 0, y: height))
                            path.addLine(to: normalizedPoints[0])
                            for pt in normalizedPoints.dropFirst() {
                                path.addLine(to: pt)
                            }
                            path.addLine(to: CGPoint(x: width, y: height))
                            path.closeSubpath()
                        }
                        .fill(
                            LinearGradient(
                                colors: [lineColor.opacity(0.25), lineColor.opacity(0.0)],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                        
                        // Inspector Probe Indicator
                        if let idx = selectedPointIndex, points.indices.contains(idx) {
                            let pt = normalizedPoints[idx]
                            Path { path in
                                path.move(to: CGPoint(x: pt.x, y: 0))
                                path.addLine(to: CGPoint(x: pt.x, y: height))
                            }
                            .stroke(lineColor.opacity(0.6), style: StrokeStyle(lineWidth: 1, dash: [2]))
                            
                            Circle()
                                .fill(lineColor)
                                .frame(width: 8, height: 8)
                                .position(pt)
                        }
                    }
                    .contentShape(Rectangle())
                    .gesture(
                        DragGesture(minimumDistance: 0)
                            .onChanged { value in
                                let step = width / CGFloat(points.count - 1)
                                let index = Int((value.location.x / step).rounded())
                                selectedPointIndex = min(max(0, index), points.count - 1)
                            }
                            .onEnded { _ in
                                selectedPointIndex = nil
                            }
                    )
                } else {
                    Text("无图表数据")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .frame(height: 70)
        }
        .padding(10)
        .background(Color(uiColor: .secondarySystemGroupedBackground))
        .cornerRadius(10)
    }
    
    private func formatTime(_ raw: String) -> String {
        if raw.count >= 16 {
            let start = raw.index(raw.startIndex, offsetBy: 11)
            let end = raw.index(raw.startIndex, offsetBy: 16)
            return String(raw[start..<end])
        }
        return raw
    }
}
