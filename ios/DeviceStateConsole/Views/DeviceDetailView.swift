import SwiftUI

public struct DeviceDetailView: View {
    @Bindable var viewModel: AppViewModel
    public let deviceId: String
    
    public var body: some View {
        NavigationStack {
            Group {
                if let metrics = viewModel.metrics {
                    ScrollView {
                        VStack(spacing: 16) {
                            // Window selector strip
                            WindowStrip(selectedWindow: viewModel.selectedWindow) { win in
                                Task { await viewModel.selectWindow(win) }
                            }
                            
                            // Overview Card Capsules
                            OverviewSection(metrics: metrics) { blockKey in
                                viewModel.openBlockSheet(blockKey)
                            } onOpenTraffic: {
                                Task { await viewModel.openTrafficSheet() }
                            }
                            
                            // Hardware Sections
                            CpuSectionView(metrics: metrics) {
                                viewModel.openBlockSheet(.cpu)
                            } onEdit: {
                                Task { await viewModel.openMetricConfigEditor(block: .cpu) }
                            }
                            
                            MemorySectionView(metrics: metrics) {
                                viewModel.openBlockSheet(.memory)
                            } onEdit: {
                                Task { await viewModel.openMetricConfigEditor(block: .memory) }
                            }
                            
                            DiskSectionView(metrics: metrics) {
                                viewModel.openBlockSheet(.disk)
                            } onEdit: {
                                Task { await viewModel.openMetricConfigEditor(block: .disk) }
                            }
                            
                            NetworkSectionView(metrics: metrics) {
                                viewModel.openBlockSheet(.network)
                            } onEdit: {
                                Task { await viewModel.openMetricConfigEditor(block: .network) }
                            }
                            
                            GpuSectionView(metrics: metrics) {
                                viewModel.openBlockSheet(.gpu)
                            } onEdit: {
                                Task { await viewModel.openMetricConfigEditor(block: .gpu) }
                            }
                            
                            FanSectionView(metrics: metrics) {
                                viewModel.openBlockSheet(.fan)
                            } onEdit: {
                                Task { await viewModel.openMetricConfigEditor(block: .fan) }
                            }
                        }
                        .padding()
                    }
                    .refreshable {
                        await viewModel.refreshMetrics()
                    }
                } else {
                    ProgressView("加载设备实时监控中...")
                }
            }
            .navigationTitle(viewModel.metrics?.hostname ?? "设备控制台")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        viewModel.showDeviceList()
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "chevron.left")
                            Text("设备")
                        }
                    }
                }
                
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await viewModel.openMetricConfigEditor() }
                    } label: {
                        Image(systemName: "slider.horizontal.3")
                    }
                }
            }
            .sheet(isPresented: $viewModel.isMetricConfigEditing) {
                MetricConfigSheet(viewModel: viewModel)
            }
            .sheet(isPresented: $viewModel.isTrafficSheetPresented) {
                TrafficView(viewModel: viewModel)
            }
            .sheet(item: Binding(
                get: { viewModel.focusedBlockKey },
                set: { viewModel.focusedBlockKey = $0 }
            )) { blockKey in
                BlockSheetView(viewModel: viewModel, blockKey: blockKey)
            }
        }
    }
}

// MARK: - Subviews & Sections

struct WindowStrip: View {
    let selectedWindow: MetricWindow
    let onSelect: (MetricWindow) -> Void
    
    var body: some View {
        HStack(spacing: 8) {
            ForEach(MetricWindow.allCases, id: \.self) { win in
                Button {
                    onSelect(win)
                } label: {
                    Text(win.label)
                        .font(.caption)
                        .fontWeight(selectedWindow == win ? .bold : .regular)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(selectedWindow == win ? Color.accentColor : Color(uiColor: .tertiarySystemGroupedBackground))
                        .foregroundStyle(selectedWindow == win ? .white : .primary)
                        .cornerRadius(8)
                }
            }
        }
        .frame(maxWidth: .infinity)
    }
}

struct OverviewSection: View {
    let metrics: MetricsDto
    let onOpenBlock: (DeviceBlockKey) -> Void
    let onOpenTraffic: () -> Void
    
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("硬件与流量概览")
                    .font(.headline)
                Spacer()
                Button("流量看板", action: onOpenTraffic)
                    .font(.caption)
                    .buttonStyle(.bordered)
            }
            
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(DeviceBlockKey.allCases, id: \.self) { blockKey in
                        OverviewCapsuleView(blockKey: blockKey, metrics: metrics) {
                            onOpenBlock(blockKey)
                        }
                    }
                }
            }
        }
        .padding()
        .background(Color(uiColor: .secondarySystemGroupedBackground))
        .cornerRadius(12)
    }
}

struct OverviewCapsuleView: View {
    let blockKey: DeviceBlockKey
    let metrics: MetricsDto
    let onClick: () -> Void
    
    var body: some View {
        Button(action: onClick) {
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(blockKey.label)
                        .font(.caption2)
                        .fontWeight(.bold)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                
                Text(getSubtitle(blockKey: blockKey, metrics: metrics))
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(.primary)
            }
            .frame(width: 100, height: 54)
            .padding(8)
            .background(Color(uiColor: .tertiarySystemGroupedBackground))
            .cornerRadius(8)
        }
        .buttonStyle(.plain)
    }
    
    private func getSubtitle(blockKey: DeviceBlockKey, metrics: MetricsDto) -> String {
        switch blockKey {
        case .cpu:
            if let last = metrics.cpuSeries?.totalUsage.last {
                return String(format: "%.0f%%", last.value)
            }
            return "正常"
        case .memory:
            if let last = metrics.memorySeries.last {
                return String(format: "%.0f%%", last.value)
            }
            return "正常"
        case .disk:
            return "\(metrics.disks.count) 块磁盘"
        case .network:
            return "\(metrics.networkInterfaces.count) 网卡"
        case .gpu:
            return "\(metrics.gpus.count) GPU"
        case .fan:
            return "\(metrics.fans.count) 风扇"
        }
    }
}

struct SectionContainer<Content: View>: View {
    let title: String
    let onOpenBlock: () -> Void
    let onEdit: () -> Void
    @ViewBuilder let content: () -> Content
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(title)
                    .font(.headline)
                Spacer()
                Button(action: onEdit) {
                    Image(systemName: "pencil")
                        .font(.caption)
                }
                Button(action: onOpenBlock) {
                    Image(systemName: "arrow.up.left.and.arrow.down.right")
                        .font(.caption)
                }
            }
            content()
        }
        .padding()
        .background(Color(uiColor: .secondarySystemGroupedBackground))
        .cornerRadius(12)
    }
}

struct CpuSectionView: View {
    let metrics: MetricsDto
    let onOpenBlock: () -> Void
    let onEdit: () -> Void
    
    var body: some View {
        SectionContainer(title: "CPU 处理器", onOpenBlock: onOpenBlock, onEdit: onEdit) {
            if let series = metrics.cpuSeries {
                MiniLineChartView(
                    title: "CPU 总体使用率",
                    points: series.totalUsage,
                    valueFormatter: { String(format: "%.1f%%", $0) },
                    fixedMaxValue: 100
                )
            }
        }
    }
}

struct MemorySectionView: View {
    let metrics: MetricsDto
    let onOpenBlock: () -> Void
    let onEdit: () -> Void
    
    var body: some View {
        SectionContainer(title: "内存 Memory", onOpenBlock: onOpenBlock, onEdit: onEdit) {
            MiniLineChartView(
                title: "内存使用率",
                points: metrics.memorySeries,
                valueFormatter: { String(format: "%.1f%%", $0) },
                fixedMaxValue: 100,
                lineColor: .purple
            )
        }
    }
}

struct DiskSectionView: View {
    let metrics: MetricsDto
    let onOpenBlock: () -> Void
    let onEdit: () -> Void
    
    var body: some View {
        SectionContainer(title: "磁盘存储 (\(metrics.disks.count))", onOpenBlock: onOpenBlock, onEdit: onEdit) {
            ForEach(metrics.disks) { disk in
                HStack {
                    VStack(alignment: .leading) {
                        Text(disk.mountPoint.isEmpty ? disk.name : disk.mountPoint)
                            .font(.subheadline)
                            .fontWeight(.medium)
                        Text("\(disk.usedBytes / 1024 / 1024 / 1024) GB / \(disk.totalBytes / 1024 / 1024 / 1024) GB")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    let percent = Double(disk.usedBytes) / Double(max(1, disk.totalBytes)) * 100
                    Text(String(format: "%.0f%%", percent))
                        .font(.subheadline)
                        .fontWeight(.bold)
                        .foregroundStyle(.orange)
                }
                .padding(8)
                .background(Color(uiColor: .tertiarySystemGroupedBackground))
                .cornerRadius(8)
            }
        }
    }
}

struct NetworkSectionView: View {
    let metrics: MetricsDto
    let onOpenBlock: () -> Void
    let onEdit: () -> Void
    
    var body: some View {
        SectionContainer(title: "网络接口 (\(metrics.networkInterfaces.count))", onOpenBlock: onOpenBlock, onEdit: onEdit) {
            ForEach(metrics.networkInterfaces) { net in
                HStack {
                    Text(net.name)
                        .font(.subheadline)
                        .fontWeight(.medium)
                    Spacer()
                    if let rx = net.rxBytesPerSec, let tx = net.txBytesPerSec {
                        Text("↓\(String(format: "%.0f", rx / 1024)) KB/s  ↑\(String(format: "%.0f", tx / 1024)) KB/s")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(8)
                .background(Color(uiColor: .tertiarySystemGroupedBackground))
                .cornerRadius(8)
            }
        }
    }
}

struct GpuSectionView: View {
    let metrics: MetricsDto
    let onOpenBlock: () -> Void
    let onEdit: () -> Void
    
    var body: some View {
        SectionContainer(title: "GPU 显卡 (\(metrics.gpus.count))", onOpenBlock: onOpenBlock, onEdit: onEdit) {
            ForEach(metrics.gpus) { gpu in
                HStack {
                    Text(gpu.name)
                        .font(.subheadline)
                        .fontWeight(.medium)
                    Spacer()
                    Text(String(format: "%.0f%%", gpu.utilizationPercent))
                        .font(.subheadline)
                        .fontWeight(.bold)
                        .foregroundStyle(.indigo)
                }
                .padding(8)
                .background(Color(uiColor: .tertiarySystemGroupedBackground))
                .cornerRadius(8)
            }
        }
    }
}

struct FanSectionView: View {
    let metrics: MetricsDto
    let onOpenBlock: () -> Void
    let onEdit: () -> Void
    
    var body: some View {
        SectionContainer(title: "散热风扇 (\(metrics.fans.count))", onOpenBlock: onOpenBlock, onEdit: onEdit) {
            ForEach(metrics.fans) { fan in
                HStack {
                    Text(fan.label)
                        .font(.subheadline)
                    Spacer()
                    Text("\(fan.rpm) RPM")
                        .font(.subheadline)
                        .fontWeight(.semibold)
                        .foregroundStyle(.teal)
                }
                .padding(8)
                .background(Color(uiColor: .tertiarySystemGroupedBackground))
                .cornerRadius(8)
            }
        }
    }
}

extension DeviceBlockKey: Identifiable {
    public var id: String { rawValue }
}
