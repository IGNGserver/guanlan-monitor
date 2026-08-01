import SwiftUI

public struct MetricConfigSheet: View {
    @Bindable var viewModel: AppViewModel
    
    public var body: some View {
        NavigationStack {
            Group {
                if let config = viewModel.metricConfig {
                    List {
                        Section("全局指标屏蔽配置") {
                            let availableMetrics = [
                                ("cpu_usage", "CPU 使用率"),
                                ("cpu_temp", "CPU 温度"),
                                ("memory_usage", "内存使用率"),
                                ("disk_usage", "磁盘空间使用率"),
                                ("disk_io", "磁盘读写吞吐"),
                                ("network_io", "网络收发速率"),
                                ("gpu_usage", "GPU 使用率"),
                                ("gpu_temp", "GPU 温度"),
                                ("fan_speed", "风扇转速")
                            ]
                            
                            ForEach(availableMetrics, id: \.0) { item in
                                Toggle(isOn: Binding(
                                    get: { !config.disabledMetrics.contains(item.0) },
                                    set: { _ in viewModel.toggleMetricConfig(metricKey: item.0) }
                                )) {
                                    Text(item.1)
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
}
