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
    }
}

struct DiskTabContent: View {
    let metrics: MetricsDto
    let tabId: String
    let window: MetricWindow
    
    var body: some View {
        if let seriesMap = metrics.diskSeries[tabId] {
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
