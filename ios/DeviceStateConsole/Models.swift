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
    
    enum CodingKeys: String, CodingKey {
        case id, name, macAddress, ipv4, ipv6
        case rxBytesPerSec, txBytesPerSec, totalRxBytes, totalTxBytes
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
}

public struct FanDto: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let label: String
    public let interfaceName: String?
    public let rpm: Int
    public let note: String?
    
    enum CodingKeys: String, CodingKey {
        case id, label, rpm, note
        case interfaceName = "interface"
    }
}

public struct CpuMetricSeriesDto: Codable, Equatable, Sendable {
    public let totalUsage: [SamplePointDto]
    public let packageUsages: [String: [SamplePointDto]]
    public let temperatures: [String: [SamplePointDto]]
    
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: DynamicCodingKeys.self)
        totalUsage = (try? container.decode([SamplePointDto].self, forKey: DynamicCodingKeys(stringValue: "totalUsage")!)) ?? []
        packageUsages = (try? container.decode([String: [SamplePointDto]].self, forKey: DynamicCodingKeys(stringValue: "packageUsages")!)) ?? [:]
        temperatures = (try? container.decode([String: [SamplePointDto]].self, forKey: DynamicCodingKeys(stringValue: "temperatures")!)) ?? [:]
    }
}

public struct DiskMetricSeriesDto: Codable, Equatable, Sendable {
    public let usedPercent: [SamplePointDto]
    public let readBytesPerSec: [SamplePointDto]
    public let writeBytesPerSec: [SamplePointDto]
}

public struct NetworkMetricSeriesDto: Codable, Equatable, Sendable {
    public let rxBytesPerSec: [SamplePointDto]
    public let txBytesPerSec: [SamplePointDto]
}

public struct GpuMetricSeriesDto: Codable, Equatable, Sendable {
    public let utilization: [SamplePointDto]
    public let memoryUsedPercent: [SamplePointDto]
    public let temperature: [SamplePointDto]
}

public struct MetricsDto: Codable, Equatable, Sendable {
    public let deviceId: String
    public let hostname: String
    public let window: String
    public let cpus: [CpuPackageDto]
    public let disks: [DiskDto]
    public let networkInterfaces: [NetworkInterfaceDto]
    public let gpus: [GpuDto]
    public let fans: [FanDto]
    
    public let cpuSeries: CpuMetricSeriesDto?
    public let memorySeries: [SamplePointDto]
    public let diskSeries: [String: DiskMetricSeriesDto]
    public let networkSeries: [String: NetworkMetricSeriesDto]
    public let gpuSeries: [String: GpuMetricSeriesDto]
    public let fanSeries: [String: [SamplePointDto]]
    
    public let currentMemoryUsedBytes: Int64?
    public let currentMemoryTotalBytes: Int64?
    public let options: [DeviceMetricOptionDto]
    
    enum CodingKeys: String, CodingKey {
        case deviceId, hostname, window, cpus, disks, networkInterfaces, gpus, fans
        case cpuSeries, memorySeries, diskSeries, networkSeries, gpuSeries, fanSeries
        case currentMemoryUsedBytes, currentMemoryTotalBytes, options
    }
    
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        deviceId = try container.decode(String.self, forKey: .deviceId)
        hostname = try container.decode(String.self, forKey: .hostname)
        window = try container.decode(String.self, forKey: .window)
        cpus = (try? container.decode([CpuPackageDto].self, forKey: .cpus)) ?? []
        disks = (try? container.decode([DiskDto].self, forKey: .disks)) ?? []
        networkInterfaces = (try? container.decode([NetworkInterfaceDto].self, forKey: .networkInterfaces)) ?? []
        gpus = (try? container.decode([GpuDto].self, forKey: .gpus)) ?? []
        fans = (try? container.decode([FanDto].self, forKey: .fans)) ?? []
        
        cpuSeries = try? container.decodeIfPresent(CpuMetricSeriesDto.self, forKey: .cpuSeries)
        memorySeries = (try? container.decodeIfPresent([SamplePointDto].self, forKey: .memorySeries)) ?? []
        diskSeries = (try? container.decodeIfPresent([String: DiskMetricSeriesDto].self, forKey: .diskSeries)) ?? [:]
        networkSeries = (try? container.decodeIfPresent([String: NetworkMetricSeriesDto].self, forKey: .networkSeries)) ?? [:]
        gpuSeries = (try? container.decodeIfPresent([String: GpuMetricSeriesDto].self, forKey: .gpuSeries)) ?? [:]
        fanSeries = (try? container.decodeIfPresent([String: [SamplePointDto]].self, forKey: .fanSeries)) ?? [:]
        
        currentMemoryUsedBytes = try? container.decodeIfPresent(Int64.self, forKey: .currentMemoryUsedBytes)
        currentMemoryTotalBytes = try? container.decodeIfPresent(Int64.self, forKey: .currentMemoryTotalBytes)
        options = (try? container.decodeIfPresent([DeviceMetricOptionDto].self, forKey: .options)) ?? []
    }
}

public struct DeviceMetricConfigDto: Codable, Equatable, Sendable {
    public let deviceId: String
    public let disabledMetrics: [String]
    public let disabledBlocks: [String]
    public let disabledDeviceInstances: [String]
    public let disabledInstanceMetrics: [String]
}

public struct DeviceMetricConfigPayloadDto: Codable, Sendable {
    public let disabledMetrics: [String]
    public let disabledBlocks: [String]
    public let disabledDeviceInstances: [String]
    public let disabledInstanceMetrics: [String]
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
