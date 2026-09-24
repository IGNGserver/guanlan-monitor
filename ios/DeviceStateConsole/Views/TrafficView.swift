import SwiftUI

public struct TrafficView: View {
    @Bindable var viewModel: AppViewModel
    
    let columns = Array(repeating: GridItem(.flexible(), spacing: 6), count: 7)
    
    public var body: some View {
        NavigationStack {
            Group {
                if let traffic = viewModel.trafficCalendar {
                    ScrollView {
                        VStack(spacing: 16) {
                            // Header controls
                            HStack {
                                Button {
                                    Task { await viewModel.shiftTrafficAnchor(direction: -1) }
                                } label: {
                                    Image(systemName: "chevron.left")
                                }
                                .disabled(traffic.prevAnchor == nil)
                                
                                Spacer()
                                
                                Text(traffic.title)
                                    .font(.headline)
                                
                                Spacer()
                                
                                Button {
                                    Task { await viewModel.shiftTrafficAnchor(direction: 1) }
                                } label: {
                                    Image(systemName: "chevron.right")
                                }
                                .disabled(traffic.nextAnchor == nil)
                            }
                            .padding(.horizontal)
                            
                            // Mode Picker
                            Picker("Mode", selection: Binding(
                                get: { viewModel.trafficMode },
                                set: { mode in Task { await viewModel.selectTrafficMode(mode) } }
                            )) {
                                Text("月视图").tag("month")
                                Text("日视图").tag("day")
                                Text("小时视图").tag("hour")
                            }
                            .pickerStyle(.segmented)
                            .padding(.horizontal)
                            
                            // Calendar Grid
                            LazyVGrid(columns: columns, spacing: 6) {
                                ForEach(traffic.cells) { cell in
                                    Button {
                                        Task { await viewModel.selectTrafficCell(cell.key) }
                                    } label: {
                                        VStack(spacing: 2) {
                                            Text(cell.label)
                                                .font(.caption2)
                                                .fontWeight(cell.selected ? .bold : .regular)
                                            Text(formatBytes(cell.totalBytes))
                                                .font(.system(size: 9))
                                                .lineLimit(1)
                                        }
                                        .frame(maxWidth: .infinity, minHeight: 44)
                                        .background(cell.selected ? Color.accentColor.opacity(0.2) : (cell.active ? Color(uiColor: .tertiarySystemGroupedBackground) : Color.clear))
                                        .foregroundStyle(cell.selected ? Color.accentColor : (cell.active ? Color.primary : Color.secondary))
                                        .cornerRadius(8)
                                        .overlay(
                                            RoundedRectangle(cornerRadius: 8)
                                                .stroke(cell.selected ? Color.accentColor : Color.clear, lineWidth: 1.5)
                                        )
                                    }
                                    .disabled(!cell.active)
                                }
                            }
                            .padding(.horizontal)
                            
                            // Stats Summary
                            VStack(spacing: 8) {
                                HStack {
                                    Text("所选时段: \(traffic.selectedLabel)")
                                        .font(.subheadline)
                                        .fontWeight(.bold)
                                    Spacer()
                                }
                                
                                HStack(spacing: 12) {
                                    TrafficStatCard(title: "下载 (Rx)", value: formatBytes(traffic.selectedRxBytes), color: .green)
                                    TrafficStatCard(title: "上传 (Tx)", value: formatBytes(traffic.selectedTxBytes), color: .blue)
                                    TrafficStatCard(title: "共计", value: formatBytes(traffic.selectedCombinedBytes), color: .purple)
                                }
                            }
                            .padding()
                            .background(Color(uiColor: .secondarySystemGroupedBackground))
                            .cornerRadius(12)
                            .padding(.horizontal)
                            
                            // Detailed Records List
                            if !traffic.records.isEmpty {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text("流量记录明细")
                                        .font(.headline)
                                        .padding(.horizontal)
                                    
                                    ForEach(traffic.records) { record in
                                        HStack {
                                            VStack(alignment: .leading, spacing: 2) {
                                                Text(record.label)
                                                    .font(.subheadline)
                                                    .fontWeight(.medium)
                                                Text(record.detailLabel)
                                                    .font(.caption)
                                                    .foregroundStyle(.secondary)
                                            }
                                            Spacer()
                                            VStack(alignment: .trailing, spacing: 2) {
                                                Text("总计: \(formatBytes(record.totalBytes))")
                                                    .font(.subheadline)
                                                    .fontWeight(.bold)
                                                Text("↓\(formatBytes(record.rxBytes))  ↑\(formatBytes(record.txBytes))")
                                                    .font(.caption2)
                                                    .foregroundStyle(.secondary)
                                            }
                                        }
                                        .padding()
                                        .background(Color(uiColor: .secondarySystemGroupedBackground))
                                        .cornerRadius(10)
                                        .padding(.horizontal)
                                    }
                                }
                            }
                        }
                        .padding(.vertical)
                    }
                } else {
                    ProgressView("加载流量数据中...")
                }
            }
            .navigationTitle("流量日历与统计")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") {
                        viewModel.closeTrafficSheet()
                    }
                }
            }
        }
    }
    
    private func formatBytes(_ bytes: Int64) -> String {
        let b = Double(bytes)
        if b >= 1024 * 1024 * 1024 {
            return String(format: "%.2f GB", b / 1024 / 1024 / 1024)
        } else if b >= 1024 * 1024 {
            return String(format: "%.1f MB", b / 1024 / 1024)
        } else if b >= 1024 {
            return String(format: "%.0f KB", b / 1024)
        }
        return "\(bytes) B"
    }
}

struct TrafficStatCard: View {
    let title: String
    let value: String
    let color: Color
    
    var body: some View {
        VStack(spacing: 4) {
            Text(title)
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.caption)
                .fontWeight(.bold)
                .foregroundStyle(color)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(Color(uiColor: .tertiarySystemGroupedBackground))
        .cornerRadius(8)
    }
}
