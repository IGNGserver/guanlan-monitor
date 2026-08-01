import Foundation
import SwiftUI
import Combine

@MainActor
@Observable
public final class AppViewModel {
    public var serverConfig: ServerConfig = ServerConfig()
    public var activeScreen: ActiveScreen = .login
    public var isLoading: Bool = false
    public var errorMessage: String? = nil
    
    public var devices: [DeviceSummaryDto] = []
    public var selectedDeviceId: String? = nil
    
    // Metrics
    public var metrics: MetricsDto? = nil
    public var selectedWindow: MetricWindow = .window1h
    public var focusedBlockKey: DeviceBlockKey? = nil
    public var metricConfig: DeviceMetricConfigDto? = nil
    public var isMetricConfigEditing: Bool = false
    public var metricConfigEditBlock: DeviceBlockKey? = nil
    public var metricConfigEditInstanceId: String? = nil
    
    // Traffic
    public var trafficCalendar: TrafficCalendarDto? = nil
    public var trafficMode: String = "month"
    public var trafficAnchor: String = ""
    public var trafficSelectedStart: String? = nil
    public var isTrafficSheetPresented: Bool = false
    
    private let apiClient = ApiClient()
    private var refreshTimer: Timer? = nil
    
    private static let baseUrlStorageKey = "dsc_server_base_url"
    private static let accessKeyStorageKey = "dsc_server_access_key"
    
    public init() {
        loadServerConfig()
    }
    
    public func loadServerConfig() {
        let baseUrl = UserDefaults.standard.string(forKey: AppViewModel.baseUrlStorageKey) ?? ""
        let accessKey = UserDefaults.standard.string(forKey: AppViewModel.accessKeyStorageKey) ?? ""
        self.serverConfig = ServerConfig(baseUrl: baseUrl, accessKey: accessKey)
    }
    
    public func saveServerConfig(baseUrl: String, accessKey: String) {
        let normalized = ApiClient.normalizeServerUrl(baseUrl)
        self.serverConfig = ServerConfig(baseUrl: normalized, accessKey: accessKey)
        UserDefaults.standard.set(normalized, forKey: AppViewModel.baseUrlStorageKey)
        UserDefaults.standard.set(accessKey, forKey: AppViewModel.accessKeyStorageKey)
    }
    
    public func login() async {
        guard !serverConfig.baseUrl.isEmpty else {
            errorMessage = "请输入服务器地址"
            return
        }
        isLoading = true
        errorMessage = nil
        
        do {
            saveServerConfig(baseUrl: serverConfig.baseUrl, accessKey: serverConfig.accessKey)
            let res = try await apiClient.login(baseUrl: serverConfig.baseUrl, accessKey: serverConfig.accessKey)
            if res.ok {
                await refreshDevicesAndNavigate()
            } else {
                errorMessage = res.error ?? "登录认证失败"
            }
        } catch {
            errorMessage = "连接失败: \(error.localizedDescription)"
        }
        isLoading = false
    }
    
    public func logout() async {
        isLoading = true
        do {
            _ = try await apiClient.logout(baseUrl: serverConfig.baseUrl)
        } catch {}
        
        saveServerConfig(baseUrl: serverConfig.baseUrl, accessKey: "")
        devices = []
        metrics = nil
        trafficCalendar = nil
        selectedDeviceId = nil
        activeScreen = .login
        stopPolling()
        isLoading = false
    }
    
    public func refreshDevicesAndNavigate() async {
        do {
            devices = try await apiClient.fetchDevices(baseUrl: serverConfig.baseUrl)
            if let currentId = selectedDeviceId, devices.contains(where: { $0.deviceId == currentId }) {
                activeScreen = .deviceDetail(deviceId: currentId)
                await refreshMetrics()
            } else if let first = devices.first {
                selectedDeviceId = first.deviceId
                activeScreen = .deviceDetail(deviceId: first.deviceId)
                await refreshMetrics()
            } else {
                activeScreen = .deviceList
            }
            startPolling()
        } catch {
            errorMessage = "获取设备列表失败: \(error.localizedDescription)"
            activeScreen = .deviceList
        }
    }
    
    public func selectDevice(deviceId: String) async {
        selectedDeviceId = deviceId
        activeScreen = .deviceDetail(deviceId: deviceId)
        await refreshMetrics()
    }
    
    public func showDeviceList() {
        activeScreen = .deviceList
    }
    
    public func selectWindow(_ window: MetricWindow) async {
        self.selectedWindow = window
        await refreshMetrics()
    }
    
    public func refreshMetrics() async {
        guard let deviceId = selectedDeviceId else { return }
        do {
            metrics = try await apiClient.fetchMetrics(baseUrl: serverConfig.baseUrl, deviceId: deviceId, window: selectedWindow.rawValue)
        } catch {
            print("刷新指标失败: \(error)")
        }
    }
    
    public func openBlockSheet(_ blockKey: DeviceBlockKey) {
        self.focusedBlockKey = blockKey
    }
    
    public func closeBlockSheet() {
        self.focusedBlockKey = nil
    }
    
    public func openTrafficSheet() async {
        guard let deviceId = selectedDeviceId else { return }
        self.isTrafficSheetPresented = true
        await refreshTraffic(deviceId: deviceId)
    }
    
    public func closeTrafficSheet() {
        self.isTrafficSheetPresented = false
    }
    
    public func selectTrafficMode(_ mode: String) async {
        self.trafficMode = mode
        self.trafficAnchor = ""
        self.trafficSelectedStart = nil
        if let deviceId = selectedDeviceId {
            await refreshTraffic(deviceId: deviceId)
        }
    }
    
    public func selectTrafficCell(_ cellKey: String) async {
        self.trafficSelectedStart = cellKey
        if let deviceId = selectedDeviceId {
            await refreshTraffic(deviceId: deviceId)
        }
    }
    
    public func shiftTrafficAnchor(direction: Int) async {
        guard let traffic = trafficCalendar else { return }
        let targetAnchor = direction < 0 ? traffic.prevAnchor : traffic.nextAnchor
        if let target = targetAnchor, !target.isEmpty {
            self.trafficAnchor = target
            if let deviceId = selectedDeviceId {
                await refreshTraffic(deviceId: deviceId)
            }
        }
    }
    
    public func refreshTraffic(deviceId: String) async {
        do {
            trafficCalendar = try await apiClient.fetchTrafficCalendar(
                baseUrl: serverConfig.baseUrl,
                deviceId: deviceId,
                mode: trafficMode,
                anchor: trafficAnchor,
                selectedStart: trafficSelectedStart
            )
        } catch {
            print("获取流量数据失败: \(error)")
        }
    }
    
    public func openMetricConfigEditor(block: DeviceBlockKey? = nil, instanceId: String? = nil) async {
        guard let deviceId = selectedDeviceId else { return }
        do {
            metricConfig = try await apiClient.fetchMetricConfig(baseUrl: serverConfig.baseUrl, deviceId: deviceId)
            metricConfigEditBlock = block
            metricConfigEditInstanceId = instanceId
            isMetricConfigEditing = true
        } catch {
            errorMessage = "读取指标配置失败: \(error.localizedDescription)"
        }
    }
    
    public func closeMetricConfigEditor() {
        isMetricConfigEditing = false
        metricConfigEditBlock = nil
        metricConfigEditInstanceId = nil
    }
    
    public func toggleMetricConfig(metricKey: String) {
        guard let config = metricConfig else { return }
        var disabled = config.disabledMetrics
        if disabled.contains(metricKey) {
            disabled.removeAll { $0 == metricKey }
        } else {
            disabled.append(metricKey)
        }
        self.metricConfig = DeviceMetricConfigDto(
            deviceId: config.deviceId,
            disabledMetrics: disabled,
            disabledBlocks: config.disabledBlocks,
            disabledDeviceInstances: config.disabledDeviceInstances,
            disabledInstanceMetrics: config.disabledInstanceMetrics
        )
    }
    
    public func saveMetricConfig() async {
        guard let deviceId = selectedDeviceId, let config = metricConfig else { return }
        do {
            let payload = DeviceMetricConfigPayloadDto(
                disabledMetrics: config.disabledMetrics,
                disabledBlocks: config.disabledBlocks,
                disabledDeviceInstances: config.disabledDeviceInstances,
                disabledInstanceMetrics: config.disabledInstanceMetrics
            )
            _ = try await apiClient.saveMetricConfig(baseUrl: serverConfig.baseUrl, deviceId: deviceId, payload: payload)
            closeMetricConfigEditor()
            await refreshMetrics()
        } catch {
            errorMessage = "保存指标配置失败: \(error.localizedDescription)"
        }
    }
    
    private func startPolling() {
        stopPolling()
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self = self else { return }
                if case .deviceDetail = self.activeScreen {
                    await self.refreshMetrics()
                } else if case .deviceList = self.activeScreen {
                    self.devices = (try? await self.apiClient.fetchDevices(baseUrl: self.serverConfig.baseUrl)) ?? self.devices
                }
            }
        }
    }
    
    private func stopPolling() {
        refreshTimer?.invalidate()
        refreshTimer = nil
    }
}
