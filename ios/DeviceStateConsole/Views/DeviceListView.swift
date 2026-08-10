import SwiftUI

public struct DeviceListView: View {
    @Bindable var viewModel: AppViewModel
    @Environment(\.openURL) private var openURL
    
    public var body: some View {
        NavigationStack {
            Group {
                if viewModel.devices.isEmpty && viewModel.isLoading {
                    ProgressView("加载设备列表中...")
                } else if viewModel.devices.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "desktopcomputer.trianglebadge.exclamationmark")
                            .font(.system(size: 48))
                            .foregroundStyle(.secondary)
                        Text("未发现在线设备")
                            .font(.headline)
                        Button("重新刷新") {
                            Task { await viewModel.refreshDevicesAndNavigate() }
                        }
                        .buttonStyle(.borderedProminent)
                    }
                } else {
                    List {
                        Section {
                            Picker("实例类型", selection: $viewModel.instanceType) {
                                Text("普通设备").tag("device")
                                Text("虚拟机").tag("virtual_machine")
                            }
                            .pickerStyle(.segmented)
                            .onChange(of: viewModel.instanceType) { _, value in
                                viewModel.selectInstanceType(value)
                            }
                        }
                        if let update = viewModel.updateInfo, update.available {
                            Section {
                                VStack(alignment: .leading, spacing: 10) {
                                    Text("发现 iOS 更新 \(update.latestVersion ?? "")")
                                        .font(.headline)
                                    Text("iOS 不能在应用内侧载安装包，请通过 App Store 或 TestFlight 完成更新。")
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                    if let urlString = update.assetUrl ?? update.releaseUrl,
                                       let url = URL(string: urlString) {
                                        Button("打开更新页面") {
                                            openURL(url)
                                        }
                                        .buttonStyle(.borderedProminent)
                                    }
                                }
                                .padding(.vertical, 6)
                            }
                        }
                        if viewModel.visibleDevices.isEmpty {
                            Section {
                                ContentUnavailableView(
                                    viewModel.instanceType == "virtual_machine" ? "未发现虚拟机" : "未发现普通设备",
                                    systemImage: viewModel.instanceType == "virtual_machine" ? "shippingbox" : "desktopcomputer"
                                )
                            }
                        }
                        ForEach(viewModel.visibleDevices) { device in
                            Button {
                                Task {
                                    await viewModel.selectDevice(deviceId: device.deviceId)
                                }
                            } label: {
                                DeviceCardRow(device: device)
                            }
                            .buttonStyle(.plain)
                        }
                        .onDelete { offsets in
                            let ids = offsets.map { viewModel.visibleDevices[$0].deviceId }
                            for id in ids {
                                Task { await viewModel.deleteDevice(deviceId: id) }
                            }
                        }
                        .onMove { offsets, destination in
                            var reordered = viewModel.visibleDevices
                            reordered.move(fromOffsets: offsets, toOffset: destination)
                            Task { await viewModel.reorderDevices(deviceIds: reordered.map(\.deviceId)) }
                        }
                    }
                    .refreshable {
                        await viewModel.refreshDevicesAndNavigate()
                    }
                }
            }
            .navigationTitle("设备列表")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(role: .destructive) {
                        Task { await viewModel.logout() }
                    } label: {
                        Image(systemName: "rectangle.portrait.and.arrow.right")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    HStack(spacing: 12) {
                        EditButton()
                        Button {
                            Task { await viewModel.refreshDevicesAndNavigate() }
                        } label: {
                            Image(systemName: "arrow.clockwise")
                        }
                    }
                }
            }
        }
    }
}

struct DeviceCardRow: View {
    let device: DeviceSummaryDto
    
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Circle()
                    .fill(device.isOnline ? Color.green : Color.secondary)
                    .frame(width: 8, height: 8)
                
                Text(device.hostname)
                    .font(.headline)
                    .foregroundStyle(.primary)
                
                Spacer()
                
                Text(device.status.capitalized)
                    .font(.caption2)
                    .fontWeight(.bold)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(device.isOnline ? Color.green.opacity(0.15) : Color.gray.opacity(0.15))
                    .foregroundStyle(device.isOnline ? Color.green : Color.gray)
                    .clipShape(Capsule())
            }
            
            Text("OS: \(device.os) • ID: \(device.deviceId)")
                .font(.caption)
                .foregroundStyle(.secondary)

            if (device.instanceType ?? "device") == "virtual_machine" {
                Label("宿主机：\(device.hostName ?? "未知")", systemImage: "server.rack")
                    .font(.caption)
                    .foregroundStyle(.tint)
            }
            
            // Usage Pill Grid
            HStack(spacing: 8) {
                if let cpu = device.cpuUsagePercent {
                    MetricPill(label: "CPU", value: String(format: "%.0f%%", cpu), color: .blue)
                }
                if let mem = device.memoryUsagePercent {
                    MetricPill(label: "内存", value: String(format: "%.0f%%", mem), color: .purple)
                }
                if let disk = device.diskUsagePercent {
                    MetricPill(label: "磁盘", value: String(format: "%.0f%%", disk), color: .orange)
                }
                if let gpu = device.gpuUsagePercent {
                    MetricPill(label: "GPU", value: String(format: "%.0f%%", gpu), color: .indigo)
                }
            }
        }
        .padding(.vertical, 6)
    }
}

struct MetricPill: View {
    let label: String
    let value: String
    let color: Color
    
    var body: some View {
        HStack(spacing: 4) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.caption2)
                .fontWeight(.bold)
                .foregroundStyle(color)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 3)
        .background(Color(uiColor: .tertiarySystemGroupedBackground))
        .cornerRadius(6)
    }
}
