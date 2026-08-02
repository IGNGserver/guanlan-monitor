import Foundation

// MARK: - API DTOs

public struct ServerConfig: Codable, Equatable, Sendable {
    public var baseUrl: String
    public var accessKey: String
    
    public init(baseUrl: String = "", accessKey: String = "") {
        self.baseUrl = baseUrl
        self.accessKey = accessKey
    }
}

public struct LoginRequestDto: Codable, Sendable {
    public let accessKey: String
    public init(accessKey: String) {
        self.accessKey = accessKey
    }
}

public struct LoginResponseDto: Codable, Sendable {
    public let ok: Bool
    public let authenticated: Bool?
    public let error: String?
}

public struct DeviceSummaryDto: Codable, Identifiable, Equatable, Sendable {
    public var id: String { deviceId }
    public let deviceId: String
    public let hostname: String
    public let os: String
    public let status: String
    public let lastSeenAt: String?
    public let cpuUsagePercent: Double?
    public let gpuUsagePercent: Double?
    public let gpuMemoryUsagePercent: Double?
    public let memoryUsagePercent: Double?
    public let diskUsagePercent: Double?
    
    public var isOnline: Bool {
        status.lowercased() == "online"
    }
}

public struct DeviceDetailDto: Codable, Equatable, Sendable {
    public let deviceId: String
    public let hostname: String
    public let os: String
    public let platform: String
    public let arch: String
    public let cpuModel: String?
    public let status: String
    public let lastSeenAt: String?
}

public struct SensorBackendDto: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let label: String
    public let ok: Bool
    public let detail: String?
}

public struct SamplePointDto: Codable, Identifiable, Equatable, Sendable {
    public var id: String { timestamp }
    public let timestamp: String
    public let value: Double
}

public struct DeviceMetricOptionDto: Codable, Identifiable, Equatable, Sendable {
    public var id: String { key }
    public let key: String
    public let available: Bool
}

public struct CpuPackageDto: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let model: String?
    public let coreCount: Int?
    public let logicalCount: Int?
    public let frequencyMHz: Double?
    public let usagePercent: Double?
    public let temperatureC: Double?
}

public struct DiskDto: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let mountPoint: String
    public let filesystem: String?
    public let model: String?
    public let vendor: String?
    public let sourceKey: String?
    public let temperatureC: Double?
    public let activePercent: Double?
    public let averageResponseMs: Double?
    public let interfaceType: String?
    public let totalBytes: Int64
    public let usedBytes: Int64
}

public struct NetworkInterfaceDto: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let macAddress: String?
    public let ipv4: [String]
    public let ipv6: [String]
    public let rxBytesPerSec: Double?
    public let txBytesPerSec: Double?
    public let totalRxBytes: Int64?
    public let totalTxBytes: Int64?
    public let linkSpeedMbps: Double?
    public let connectionType: String?
    public let signalStrengthPercent: Double?
    
    enum CodingKeys: String, CodingKey {
        case id, name, macAddress, ipv4, ipv6
        case rxBytesPerSec, txBytesPerSec, totalRxBytes, totalTxBytes
        case linkSpeedMbps, connectionType, signalStrengthPercent
    }
    
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        macAddress = try container.decodeIfPresent(String.self, forKey: .macAddress)
        ipv4 = try container.decodeIfPresent([String].self, forKey: .ipv4) ?? []
        ipv6 = try container.decodeIfPresent([String].self, forKey: .ipv6) ?? []
        rxBytesPerSec = try container.decodeIfPresent(Double.self, forKey: .rxBytesPerSec)
        txBytesPerSec = try container.decodeIfPresent(Double.self, forKey: .txBytesPerSec)
        totalRxBytes = try container.decodeIfPresent(Int64.self, forKey: .totalRxBytes)
        totalTxBytes = try container.decodeIfPresent(Int64.self, forKey: .totalTxBytes)
        linkSpeedMbps = try container.decodeIfPresent(Double.self, forKey: .linkSpeedMbps)
        connectionType = try container.decodeIfPresent(String.self, forKey: .connectionType)
        signalStrengthPercent = try container.decodeIfPresent(Double.self, forKey: .signalStrengthPercent)
    }
}

public struct GpuDto: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let utilizationPercent: Double
    public let encodeUtilizationPercent: Double?
    public let decodeUtilizationPercent: Double?
    public let frequencyMHz: Double?
    public let memoryUsedBytes: Int64
    public let memoryTotalBytes: Int64
    public let temperatureC: Double?
    public let driverVersion: String?
}

public struct FanDto: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let label: String
    public let interfaceName: String?
    public let rpm: Int
    public let note: String?
    public let controlMode: String?
    public let targetTemperatureC: Double?
    public let minPwmPercent: Double?
    public let maxPwmPercent: Double?
    public let channelState: String?
    
    enum CodingKeys: String, CodingKey {
        case id, label, rpm, note, controlMode, targetTemperatureC, minPwmPercent, maxPwmPercent, channelState
        case interfaceName = "interface"
    }
}

public struct CpuMetricSeriesDto: Codable, Equatable, Sendable {
    public let totalUsage: [SamplePointDto]
    public let packageUsages: [String: [SamplePointDto]]
    public let temperatures: [String: [SamplePointDto]]
    public let frequencies: [String: [SamplePointDto]]

    public init(totalUsage: [SamplePointDto], packageUsages: [String: [SamplePointDto]], temperatures: [String: [SamplePointDto]], frequencies: [String: [SamplePointDto]] = [:]) {
        self.totalUsage = totalUsage
        self.packageUsages = packageUsages
        self.temperatures = temperatures
        self.frequencies = frequencies
    }
    
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: DynamicCodingKeys.self)
        totalUsage = (try? container.decode([SamplePointDto].self, forKey: DynamicCodingKeys(stringValue: "totalUsage")!)) ?? []
        packageUsages = (try? container.decode([String: [SamplePointDto]].self, forKey: DynamicCodingKeys(stringValue: "packageUsages")!)) ?? [:]
        temperatures = (try? container.decode([String: [SamplePointDto]].self, forKey: DynamicCodingKeys(stringValue: "temperatures")!)) ?? [:]
        frequencies = (try? container.decode([String: [SamplePointDto]].self, forKey: DynamicCodingKeys(stringValue: "frequencies")!)) ?? [:]
    }
}

public struct DiskMetricSeriesDto: Codable, Equatable, Sendable {
    public let usedPercent: [SamplePointDto]
    public let readBytesPerSec: [SamplePointDto]
    public let writeBytesPerSec: [SamplePointDto]
    public let activePercent: [SamplePointDto]
    public let usedBytes: [SamplePointDto]
    public let temperatureC: [SamplePointDto]
}

public struct NetworkMetricSeriesDto: Codable, Equatable, Sendable {
    public let rxBytesPerSec: [SamplePointDto]
    public let txBytesPerSec: [SamplePointDto]
    public let trafficRxBytes: [SamplePointDto]
    public let trafficTxBytes: [SamplePointDto]
}

public struct GpuMetricSeriesDto: Codable, Equatable, Sendable {
    public let utilization: [SamplePointDto]
    public let encode: [SamplePointDto]
    public let decode: [SamplePointDto]
    public let frequencyMHz: [SamplePointDto]
    public let memoryUsedPercent: [SamplePointDto]
    public let memoryUsedBytes: [SamplePointDto]
    public let temperature: [SamplePointDto]
}

private struct SystemStatsDto: Codable, Equatable, Sendable {
    let processCount: Int
    let threadCount: Int
    let handleCount: Int64
}

private struct ServerLatestDto: Codable, Equatable, Sendable {
    let system: SystemStatsDto
    let cpuFrequencyMHz: Double?
    let cpuTemperatureC: Double?
    let cpuPackages: [CpuPackageDto]
    let memoryUsedBytes: Int64
    let memoryTotalBytes: Int64
    let memoryAvailableBytes: Int64
    let memoryCachedBytes: Int64
    let memoryCommittedBytes: Int64
    let memorySpeedMHz: Double?
    let memorySlotCount: Int?
    let memoryFormFactor: String?
    let swapUsedBytes: Int64
    let swapTotalBytes: Int64
    let diskUsedBytes: Int64
    let diskTotalBytes: Int64
    let networkRxBytesPerSec: Double
    let networkTxBytesPerSec: Double
    let disks: [DiskDto]
    let networkInterfaces: [NetworkInterfaceDto]
    let gpus: [GpuDto]
    let sensorBackends: [SensorBackendDto]
    let fans: [FanDto]
}

private struct ServerCpuSeriesDto: Codable, Equatable, Sendable {
    let id: String
    let usagePercent: [SamplePointDto]
    let frequencyMHz: [SamplePointDto]
    let temperatureC: [SamplePointDto]
}

private struct ServerDiskSeriesDto: Codable, Equatable, Sendable {
    let id: String
    let name: String
    let mountPoint: String
    let filesystem: String?
    let model: String?
    let vendor: String?
    let usagePercent: [SamplePointDto]
    let activePercent: [SamplePointDto]
    let usedBytes: [SamplePointDto]
    let readBytesPerSec: [SamplePointDto]
    let writeBytesPerSec: [SamplePointDto]
    let temperatureC: [SamplePointDto]
}

private struct ServerNetworkSeriesDto: Codable, Equatable, Sendable {
    let id: String
    let rxBytesPerSec: [SamplePointDto]
    let txBytesPerSec: [SamplePointDto]
    let trafficRxBytes: [SamplePointDto]
    let trafficTxBytes: [SamplePointDto]
}

private struct ServerGpuSeriesDto: Codable, Equatable, Sendable {
    let id: String
    let usagePercent: [SamplePointDto]
    let encodePercent: [SamplePointDto]
    let decodePercent: [SamplePointDto]
    let frequencyMHz: [SamplePointDto]
    let memoryUsagePercent: [SamplePointDto]
    let memoryUsedBytes: [SamplePointDto]
    let temperatureC: [SamplePointDto]
}

private struct ServerFanSeriesDto: Codable, Equatable, Sendable {
    let id: String
    let rpm: [SamplePointDto]
}

private struct ServerMetricSeriesDto: Codable, Equatable, Sendable {
    let cpuUsagePercent: [SamplePointDto]
    let memoryUsagePercent: [SamplePointDto]
    let memoryAvailableBytes: [SamplePointDto]
    let memoryCachedBytes: [SamplePointDto]
    let memoryCommittedBytes: [SamplePointDto]
    let systemProcessCount: [SamplePointDto]
    let systemThreadCount: [SamplePointDto]
    let systemHandleCount: [SamplePointDto]
    let cpus: [ServerCpuSeriesDto]
    let disks: [ServerDiskSeriesDto]
    let networks: [ServerNetworkSeriesDto]
    let gpus: [ServerGpuSeriesDto]
    let fans: [ServerFanSeriesDto]
}

public struct MetricsDto: Decodable, Equatable, Sendable {
    public let deviceId: String
    public let hostname: String
    public let window: String
    public let cpus: [CpuPackageDto]
    public let disks: [DiskDto]
    public let networkInterfaces: [NetworkInterfaceDto]
    public let gpus: [GpuDto]
    public let fans: [FanDto]
    public let sensorBackends: [SensorBackendDto]
    
    public let cpuSeries: CpuMetricSeriesDto?
    public let memorySeries: [SamplePointDto]
    public let memoryUsedBytesSeries: [SamplePointDto]
    public let swapUsedBytesSeries: [SamplePointDto]
    public let memoryAvailableSeries: [SamplePointDto]
    public let memoryCachedSeries: [SamplePointDto]
    public let memoryCommittedSeries: [SamplePointDto]
    public let processSeries: [SamplePointDto]
    public let threadSeries: [SamplePointDto]
    public let handleSeries: [SamplePointDto]
    public let diskSeries: [String: DiskMetricSeriesDto]
    public let networkSeries: [String: NetworkMetricSeriesDto]
    public let gpuSeries: [String: GpuMetricSeriesDto]
    public let fanSeries: [String: [SamplePointDto]]
    
    public let currentMemoryUsedBytes: Int64?
    public let currentMemoryTotalBytes: Int64?
    public let options: [DeviceMetricOptionDto]
    public let status: String
    public let lastSeenAt: String?
    public let platform: String
    public let arch: String
    public let cpuModel: String?
    public let processCount: Int
    public let threadCount: Int
    public let handleCount: Int64
    public let memoryAvailableBytes: Int64
    public let memoryCachedBytes: Int64
    public let memoryCommittedBytes: Int64
    public let memorySpeedMHz: Double?
    public let memorySlotCount: Int?
    public let memoryFormFactor: String?
    public let cpuFrequencyMHz: Double?
    public let cpuTemperatureC: Double?
    public let swapUsedBytes: Int64
    public let swapTotalBytes: Int64
    public let diskUsedBytes: Int64
    public let diskTotalBytes: Int64
    public let networkRxBytesPerSec: Double
    public let networkTxBytesPerSec: Double
    
    enum CodingKeys: String, CodingKey {
        case device, status, lastSeenAt, availableMetrics, latest, series
    }
    
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let device = try container.decode(DeviceDetailDto.self, forKey: .device)
        let latest = try container.decode(ServerLatestDto.self, forKey: .latest)
        let series = try container.decode(ServerMetricSeriesDto.self, forKey: .series)
        deviceId = device.deviceId
        hostname = device.hostname
        window = "current"
        status = try container.decodeIfPresent(String.self, forKey: .status) ?? device.status
        lastSeenAt = try container.decodeIfPresent(String.self, forKey: .lastSeenAt)
        platform = device.platform
        arch = device.arch
        cpuModel = device.cpuModel
        cpus = latest.cpuPackages
        disks = latest.disks
        networkInterfaces = latest.networkInterfaces
        gpus = latest.gpus
        fans = latest.fans
        sensorBackends = latest.sensorBackends
        cpuSeries = CpuMetricSeriesDto(totalUsage: series.cpuUsagePercent, packageUsages: Dictionary(uniqueKeysWithValues: series.cpus.map { ($0.id, $0.usagePercent) }), temperatures: Dictionary(uniqueKeysWithValues: series.cpus.map { ($0.id, $0.temperatureC) }), frequencies: Dictionary(uniqueKeysWithValues: series.cpus.map { ($0.id, $0.frequencyMHz) }))
        memorySeries = series.memoryUsagePercent
        memoryUsedBytesSeries = series.memoryUsedBytes
        swapUsedBytesSeries = series.swapUsedBytes
        memoryAvailableSeries = series.memoryAvailableBytes
        memoryCachedSeries = series.memoryCachedBytes
        memoryCommittedSeries = series.memoryCommittedBytes
        processSeries = series.systemProcessCount
        threadSeries = series.systemThreadCount
        handleSeries = series.systemHandleCount
        diskSeries = Dictionary(uniqueKeysWithValues: series.disks.map { ($0.id, DiskMetricSeriesDto(usedPercent: $0.usagePercent, readBytesPerSec: $0.readBytesPerSec, writeBytesPerSec: $0.writeBytesPerSec, activePercent: $0.activePercent, usedBytes: $0.usedBytes, temperatureC: $0.temperatureC)) })
        networkSeries = Dictionary(uniqueKeysWithValues: series.networks.map { ($0.id, NetworkMetricSeriesDto(rxBytesPerSec: $0.rxBytesPerSec, txBytesPerSec: $0.txBytesPerSec, trafficRxBytes: $0.trafficRxBytes, trafficTxBytes: $0.trafficTxBytes)) })
        gpuSeries = Dictionary(uniqueKeysWithValues: series.gpus.map { ($0.id, GpuMetricSeriesDto(utilization: $0.usagePercent, encode: $0.encodePercent, decode: $0.decodePercent, frequencyMHz: $0.frequencyMHz, memoryUsedPercent: $0.memoryUsagePercent, memoryUsedBytes: $0.memoryUsedBytes, temperature: $0.temperatureC)) })
        fanSeries = Dictionary(uniqueKeysWithValues: series.fans.map { ($0.id, $0.rpm) })
        currentMemoryUsedBytes = latest.memoryUsedBytes
        currentMemoryTotalBytes = latest.memoryTotalBytes
        options = (try? container.decodeIfPresent([DeviceMetricOptionDto].self, forKey: .availableMetrics)) ?? []
        processCount = latest.system.processCount
        threadCount = latest.system.threadCount
        handleCount = latest.system.handleCount
        memoryAvailableBytes = latest.memoryAvailableBytes
        memoryCachedBytes = latest.memoryCachedBytes
        memoryCommittedBytes = latest.memoryCommittedBytes
        memorySpeedMHz = latest.memorySpeedMHz
        memorySlotCount = latest.memorySlotCount
        memoryFormFactor = latest.memoryFormFactor
        cpuFrequencyMHz = latest.cpuFrequencyMHz
        cpuTemperatureC = latest.cpuTemperatureC
        swapUsedBytes = latest.swapUsedBytes
        swapTotalBytes = latest.swapTotalBytes
        diskUsedBytes = latest.diskUsedBytes
        diskTotalBytes = latest.diskTotalBytes
        networkRxBytesPerSec = latest.networkRxBytesPerSec
        networkTxBytesPerSec = latest.networkTxBytesPerSec
    }
}

public struct DeviceMetricConfigDto: Codable, Equatable, Sendable {
    public let deviceId: String
    public let availableMetrics: [DeviceMetricOptionDto]
    public let enabledMetrics: [String]
    public let enabledDeviceIds: [String: [String]]
    public let instanceMetricConfig: [String: [String]]
}

public struct DeviceMetricConfigPayloadDto: Codable, Sendable {
    public let enabledMetrics: [String]
    public let enabledDeviceIds: [String: [String]]
    public let instanceMetricConfig: [String: [String]]
}

public struct TrafficCalendarCellDto: Codable, Identifiable, Equatable, Sendable {
    public var id: String { key }
    public let key: String
    public let label: String
    public let rxBytes: Int64
    public let txBytes: Int64
    public let totalBytes: Int64
    public let active: Bool
    public let selected: Bool
}

public struct TrafficCalendarRecordDto: Codable, Identifiable, Equatable, Sendable {
    public var id: String { key }
    public let key: String
    public let time: String
    public let label: String
    public let detailLabel: String
    public let rxBytes: Int64
    public let txBytes: Int64
    public let totalBytes: Int64
}

public struct TrafficCalendarDto: Codable, Equatable, Sendable {
    public let deviceId: String
    public let hostname: String
    public let mode: String
    public let anchor: String
    public let title: String
    public let periodLabel: String
    public let prevAnchor: String?
    public let nextAnchor: String?
    public let cells: [TrafficCalendarCellDto]
    public let selectedLabel: String
    public let totalRxBytes: Int64
    public let totalTxBytes: Int64
    public let totalCombinedBytes: Int64
    public let selectedRxBytes: Int64
    public let selectedTxBytes: Int64
    public let selectedCombinedBytes: Int64
    public let records: [TrafficCalendarRecordDto]
}

// MARK: - Enums & Dynamic Coding Keys

struct DynamicCodingKeys: CodingKey {
    var stringValue: String
    init?(stringValue: String) { self.stringValue = stringValue }
    var intValue: Int? { nil }
    init?(intValue: Int) { return nil }
}

public enum DeviceBlockKey: String, CaseIterable, Codable, Sendable {
    case cpu = "cpu"
    case memory = "memory"
    case disk = "disk"
    case network = "network"
    case gpu = "gpu"
    case fan = "fan"
    
    public var label: String {
        switch self {
        case .cpu: return "CPU"
        case .memory: return "内存"
        case .disk: return "磁盘"
        case .network: return "网络"
        case .gpu: return "GPU"
        case .fan: return "风扇"
        }
    }
}

public enum MetricWindow: String, CaseIterable, Codable, Sendable {
    case window1h = "1h"
    case window6h = "6h"
    case window24h = "24h"
    case window7d = "7d"
    case window30d = "30d"
    
    public var label: String {
        switch self {
        case .window1h: return "1小时"
        case .window6h: return "6小时"
        case .window24h: return "24小时"
        case .window7d: return "7天"
        case .window30d: return "30天"
        }
    }
}

public enum ActiveScreen: Equatable, Sendable {
    case login
    case deviceList
    case deviceDetail(deviceId: String)
    case traffic(deviceId: String)
}

public struct OverviewCapsuleModel: Identifiable, Equatable, Sendable {
    public var id: String { key.rawValue }
    public let key: DeviceBlockKey
    public let title: String
    public let badge: String
    public let isOnline: Bool
    public let subtitle: String
}
