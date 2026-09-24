import SwiftUI

public struct BlockSheetView: View {
    @Bindable var viewModel: AppViewModel
    public let blockKey: DeviceBlockKey
    
    @State private var selectedTabId: String = "overview"
    
    public var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if let metrics = viewModel.metrics {
                    let tabs = buildBlockTabs(metrics: metrics, blockKey: blockKey)
                    
                    if tabs.count > 1 {
                        Picker("Tab", selection: $selectedTabId) {
                            ForEach(tabs, id: \.id) { tab in
                                Text(tab.label).tag(tab.id)
                            }
                        }
                        .pickerStyle(.segmented)
                        .padding()
                    }
                    
                    ScrollView {
                        VStack(spacing: 16) {
                            switch blockKey {
                            case .cpu:
                                CpuTabContent(metrics: metrics, tabId: selectedTabId, window: viewModel.selectedWindow)
                            case .memory:
                                MemoryTabContent(metrics: metrics)
                            case .disk:
                                DiskTabContent(metrics: metrics, tabId: selectedTabId, window: viewModel.selectedWindow)
                            case .network:
                                NetworkTabContent(metrics: metrics, tabId: selectedTabId, window: viewModel.selectedWindow)
                            case .gpu:
                                GpuTabContent(metrics: metrics, tabId: selectedTabId, window: viewModel.selectedWindow)
                            case .fan:
                                FanTabContent(metrics: metrics, tabId: selectedTabId)
                            }
                        }
                        .padding()
                    }
                } else {
                    ProgressView("加载详细图表中...")
                        .padding()
                }
            }
            .navigationTitle("\(blockKey.label) 仪表盘明细")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") {
                        viewModel.closeBlockSheet()
                    }
                }
            }
        }
    }
    
    private struct TabModel: Identifiable {
        let id: String
        let label: String
    }
    
    private func buildBlockTabs(metrics: MetricsDto, blockKey: DeviceBlockKey) -> [TabModel] {
        var list: [TabModel] = [TabModel(id: "overview", label: "总体趋势")]
        switch blockKey {
        case .cpu:
            for cpu in metrics.cpus {
                list.append(TabModel(id: cpu.id, label: cpu.name))
            }
        case .disk:
            for disk in metrics.disks {
                list.append(TabModel(id: disk.id, label: disk.mountPoint.isEmpty ? disk.name : disk.mountPoint))
            }
        case .network:
            for net in metrics.networkInterfaces {
                list.append(TabModel(id: net.id, label: net.name))
            }
        case .gpu:
            for gpu in metrics.gpus {
                list.append(TabModel(id: gpu.id, label: gpu.name))
            }
        default: break
        }
        return list
    }
}

// MARK: - Tab Contents

struct CpuTabContent: View {
    let metrics: MetricsDto
    let tabId: String
    let window: MetricWindow
    
    var body: some View {
        if tabId == "overview" {
            if let series = metrics.cpuSeries {
                MiniLineChartView(
                    title: "CPU 整体使用率 (%)",
                    points: series.totalUsage,
                    valueFormatter: { String(format: "%.1f%%", $0) },
                    fixedMaxValue: 100
                )
            }
        } else {
            if let pkg = metrics.cpus.first(where: { $0.id == tabId }) {
                VStack(alignment: .leading, spacing: 12) {
                    Text(pkg.name).font(.headline)
                    if let series = metrics.cpuSeries {
                        if let usage = series.packageUsages[pkg.id] {
                            MiniLineChartView(
                                title: "核心使用率 (%)",
                                points: usage,
                                valueFormatter: { String(format: "%.1f%%", $0) },
                                fixedMaxValue: 100
                            )
                        }
                        if let temp = series.temperatures[pkg.id] {
                            MiniLineChartView(
                                title: "核心温度 (°C)",
                                points: temp,
                                valueFormatter: { String(format: "%.1f°C", $0) },
                                lineColor: .red
                            )
                        }
                        if let frequency = series.frequencies[pkg.id] {
                            MiniLineChartView(
                                title: "核心频率 (MHz)",
                                points: frequency,
                                valueFormatter: { String(format: "%.0f MHz", $0) },
                                lineColor: .orange
                            )
                        }
                    }
                }
            }
        }
    }
}

struct MemoryTabContent: View {
    let metrics: MetricsDto
    
    var body: some View {
        MiniLineChartView(
            title: "内存已用率 (%)",
            points: metrics.memorySeries,
            valueFormatter: { String(format: "%.1f%%", $0) },
            fixedMaxValue: 100,
            lineColor: .purple
        )
        MiniLineChartView(title: "已用内存", points: metrics.memoryUsedBytesSeries, valueFormatter: { ByteCountFormatter.string(fromByteCount: Int64($0), countStyle: .file) }, lineColor: .purple)
        MiniLineChartView(title: "Swap 已用", points: metrics.swapUsedBytesSeries, valueFormatter: { ByteCountFormatter.string(fromByteCount: Int64($0), countStyle: .file) }, lineColor: .orange)
        MiniLineChartView(title: "可用内存", points: metrics.memoryAvailableSeries, valueFormatter: { ByteCountFormatter.string(fromByteCount: Int64($0), countStyle: .file) }, lineColor: .blue)
        MiniLineChartView(title: "缓存内存", points: metrics.memoryCachedSeries, valueFormatter: { ByteCountFormatter.string(fromByteCount: Int64($0), countStyle: .file) }, lineColor: .green)
        MiniLineChartView(title: "已提交内存", points: metrics.memoryCommittedSeries, valueFormatter: { ByteCountFormatter.string(fromByteCount: Int64($0), countStyle: .file) }, lineColor: .orange)
    }
}

struct DiskTabContent: View {
    let metrics: MetricsDto
    let tabId: String
    let window: MetricWindow
    
    var body: some View {
        if let seriesMap = metrics.diskSeries[tabId] {
            if let disk = metrics.disks.first(where: { $0.id == tabId }) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("健康 \(disk.healthStatus.map(formatDiskHealth) ?? "未知") · 寿命 \(disk.healthPercent.map { String(format: "%.0f%%", $0) } ?? "未知") · 温度 \(disk.temperatureC.map { String(format: "%.1f°C", $0) } ?? "未知")")
                        .font(.subheadline)
                    if let reason = disk.healthReason, !reason.isEmpty {
                        Text("健康来源：\(reason)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if let smartAttributes = disk.smartAttributes, !smartAttributes.isEmpty {
                        Text(smartAttributes.map { "SMART \($0.id) \($0.name)：\(String(format: "%.0f", $0.value)) / 阈值 \(String(format: "%.0f", $0.threshold))" }.joined(separator: " · "))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            MiniLineChartView(
                title: "使用率 (%)",
                points: seriesMap.usedPercent,
                valueFormatter: { String(format: "%.1f%%", $0) },
                fixedMaxValue: 100,
                lineColor: .orange
            )
            MiniLineChartView(
                title: "读取速率 (MB/s)",
                points: seriesMap.readBytesPerSec,
                valueFormatter: { String(format: "%.2f MB/s", $0 / 1024 / 1024) },
                lineColor: .blue
            )
            MiniLineChartView(
                title: "写入速率 (MB/s)",
                points: seriesMap.writeBytesPerSec,
                valueFormatter: { String(format: "%.2f MB/s", $0 / 1024 / 1024) },
                lineColor: .green
            )
            MiniLineChartView(title: "活动时间 (%)", points: seriesMap.activePercent, valueFormatter: { String(format: "%.1f%%", $0) }, fixedMaxValue: 100, lineColor: .orange)
            MiniLineChartView(title: "温度 (°C)", points: seriesMap.temperatureC, valueFormatter: { String(format: "%.1f°C", $0) }, lineColor: .red)
        } else {
            Text("无磁盘历史序列")
        }
    }
}

struct NetworkTabContent: View {
    let metrics: MetricsDto
    let tabId: String
    let window: MetricWindow
    
    var body: some View {
        if let netSeries = metrics.networkSeries[tabId] {
            MiniLineChartView(
                title: "接收速率 Rx (KB/s)",
                points: netSeries.rxBytesPerSec,
                valueFormatter: { String(format: "%.1f KB/s", $0 / 1024) },
                lineColor: .green
            )
            MiniLineChartView(
                title: "发送速率 Tx (KB/s)",
                points: netSeries.txBytesPerSec,
                valueFormatter: { String(format: "%.1f KB/s", $0 / 1024) },
                lineColor: .blue
            )
            MiniLineChartView(title: "累计接收", points: netSeries.trafficRxBytes, valueFormatter: { ByteCountFormatter.string(fromByteCount: Int64($0), countStyle: .file) }, lineColor: .green)
            MiniLineChartView(title: "累计发送", points: netSeries.trafficTxBytes, valueFormatter: { ByteCountFormatter.string(fromByteCount: Int64($0), countStyle: .file) }, lineColor: .blue)
        }
    }
}

struct GpuTabContent: View {
    let metrics: MetricsDto
    let tabId: String
    let window: MetricWindow
    
    var body: some View {
        if let series = metrics.gpuSeries[tabId] {
            MiniLineChartView(
                title: "GPU 利用率 (%)",
                points: series.utilization,
                valueFormatter: { String(format: "%.1f%%", $0) },
                fixedMaxValue: 100,
                lineColor: .indigo
            )
            MiniLineChartView(
                title: "显存使用率 (%)",
                points: series.memoryUsedPercent,
                valueFormatter: { String(format: "%.1f%%", $0) },
                fixedMaxValue: 100,
                lineColor: .purple
            )
            MiniLineChartView(title: "显存已用", points: series.memoryUsedBytes, valueFormatter: { ByteCountFormatter.string(fromByteCount: Int64($0), countStyle: .file) }, lineColor: .purple)
            MiniLineChartView(title: "编码 (%)", points: series.encode, valueFormatter: { String(format: "%.1f%%", $0) }, fixedMaxValue: 100, lineColor: .blue)
            MiniLineChartView(title: "解码 (%)", points: series.decode, valueFormatter: { String(format: "%.1f%%", $0) }, fixedMaxValue: 100, lineColor: .green)
            MiniLineChartView(title: "频率 (MHz)", points: series.frequencyMHz, valueFormatter: { String(format: "%.0f MHz", $0) }, lineColor: .orange)
        }
    }
}

struct FanTabContent: View {
    let metrics: MetricsDto
    let tabId: String
    
    var body: some View {
        if let series = metrics.fanSeries[tabId] {
            MiniLineChartView(
                title: "风扇转速 (RPM)",
                points: series,
                valueFormatter: { String(format: "%.0f RPM", $0) },
                lineColor: .teal
            )
        }
    }
}
