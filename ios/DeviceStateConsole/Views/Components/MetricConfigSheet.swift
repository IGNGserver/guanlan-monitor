import SwiftUI

public struct MetricConfigSheet: View {
    @Bindable var viewModel: AppViewModel
    
    public var body: some View {
        NavigationStack {
            Group {
                if let config = viewModel.metricConfig {
                    List {
                        Section("全局指标屏蔽配置") {
                            ForEach(config.availableMetrics.filter { $0.available }) { item in
                                Toggle(isOn: Binding(
                                    get: { config.enabledMetrics.contains(item.key) },
                                    set: { _ in viewModel.toggleMetricConfig(metricKey: item.key) }
                                )) {
                                    Text(metricLabel(item.key))
                                        .font(.body)
                                }
                            }
                        }
                    }
                } else {
                    ProgressView("加载指标配置中...")
                        .padding()
                }
            }
            .navigationTitle("自定义面板指标")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") {
                        viewModel.closeMetricConfigEditor()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") {
                        Task {
                            await viewModel.saveMetricConfig()
                        }
                    }
                    .bold()
                }
            }
        }
    }

    private func metricLabel(_ key: String) -> String {
        switch key {
        case "cpuUsage": return "CPU 使用率"
        case "cpuFrequency": return "CPU 频率"
        case "cpuTemperature": return "CPU 温度"
        case "gpuUsage": return "GPU 使用率"
        case "gpuEncode": return "GPU 编码"
        case "gpuDecode": return "GPU 解码"
        case "gpuFrequency": return "GPU 频率"
        case "gpuMemory": return "GPU 显存"
        case "gpuTemperature": return "GPU 温度"
        case "memoryUsage": return "内存使用率"
        case "swapUsage": return "交换空间"
        case "diskUsage": return "磁盘活动率"
        case "diskRead": return "磁盘读取"
        case "diskWrite": return "磁盘写入"
        case "networkRxRate": return "网络接收"
        case "networkTxRate": return "网络发送"
        case "networkTraffic": return "网络累计流量"
        default: return key
        }
    }
}
