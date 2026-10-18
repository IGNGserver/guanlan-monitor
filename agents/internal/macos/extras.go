package macos

import (
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
)

// ---------------------------------------------------------------- storage

type StorageDevice struct {
	BSDName, Product, Vendor, Medium, Interconnect, Location string
	NVMe                                                     *struct{ Log, Error string }
	ATA                                                      *struct {
		ThresholdExceeded       *bool
		Data, Thresholds, Error string
	}
}

type SMARTAttribute struct {
	ID        int
	Name      string
	Value     float64
	Threshold float64
}

// DiskHealth is one device's SMART reading. Status is "good" or "bad" only
// when the device itself reported it; an unreadable log leaves it empty.
type DiskHealth struct {
	Source        string
	TemperatureC  *float64
	Status        string
	Reason        string
	HealthPercent *float64
	Attributes    []SMARTAttribute
}

type DiskInfo struct {
	Model, Vendor, InterfaceType, Medium string
	Health                               *DiskHealth
	HealthError                          string
}

func ParseStorage(raw []byte) ([]StorageDevice, error) {
	var devices []StorageDevice
	if err := json.Unmarshal(raw, &devices); err != nil {
		return nil, err
	}
	return devices, nil
}

// StorageInventory maps whole-disk BSD names (disk0) to their metadata and
// SMART health. Virtual disks (APFS synthesized containers, disk images) keep
// no metadata of their own: their IO and health belong to the physical store.
func StorageInventory(devices []StorageDevice) map[string]DiskInfo {
	result := map[string]DiskInfo{}
	for _, device := range devices {
		if device.BSDName == "" || strings.EqualFold(device.Interconnect, "Virtual Interface") {
			continue
		}
		info := DiskInfo{Model: device.Product, Vendor: device.Vendor, Medium: device.Medium, InterfaceType: storageInterface(device)}
		if info.Vendor != "" && strings.HasPrefix(strings.ToLower(info.Model), strings.ToLower(info.Vendor)) {
			info.Vendor = ""
		}
		switch {
		case device.NVMe != nil && device.NVMe.Log != "":
			bytes, err := hex.DecodeString(device.NVMe.Log)
			if health, parseErr := ParseNVMeSMART(bytes); err == nil && parseErr == nil {
				info.Health = &health
			} else {
				info.HealthError = "invalid NVMe SMART log"
			}
		case device.NVMe != nil:
			info.HealthError = device.NVMe.Error
		case device.ATA != nil && device.ATA.Error != "":
			info.HealthError = device.ATA.Error
		case device.ATA != nil:
			data, _ := hex.DecodeString(device.ATA.Data)
			thresholds, _ := hex.DecodeString(device.ATA.Thresholds)
			if health, err := ParseATASMART(device.ATA.ThresholdExceeded, data, thresholds); err == nil {
				info.Health = &health
			} else {
				info.HealthError = err.Error()
			}
		}
		result[device.BSDName] = info
	}
	return result
}

func storageInterface(device StorageDevice) string {
	interconnect := strings.TrimSpace(device.Interconnect)
	name := interconnect
	switch {
	case device.NVMe != nil:
		name = "NVMe"
	case strings.EqualFold(interconnect, "SATA"), strings.EqualFold(interconnect, "Serial ATA"):
		name = "SATA"
	case strings.EqualFold(interconnect, "USB"):
		name = "USB"
	}
	if strings.EqualFold(device.Location, "External") && name != "" && !strings.Contains(strings.ToLower(name), "usb") {
		name += " (external)"
	}
	return name
}

const nvmeLogSize = 512

func le128(bytes []byte) float64 {
	low := binary.LittleEndian.Uint64(bytes[:8])
	high := binary.LittleEndian.Uint64(bytes[8:16])
	return float64(high)*math.Pow(2, 64) + float64(low)
}

// ParseNVMeSMART decodes the NVMe SMART / Health Information log page (NVMe
// 1.0c section 5.10.1.2) exactly as the controller returned it.
func ParseNVMeSMART(log []byte) (DiskHealth, error) {
	if len(log) != nvmeLogSize {
		return DiskHealth{}, fmt.Errorf("NVMe SMART log has %d bytes", len(log))
	}
	health := DiskHealth{Source: "NVMe SMART"}
	warning := log[0]
	kelvin := float64(binary.LittleEndian.Uint16(log[1:3]))
	if celsius := kelvin - 273; kelvin > 0 && celsius > -40 && celsius < 150 {
		health.TemperatureC = &celsius
	}
	spare, spareThreshold, used := float64(log[3]), float64(log[4]), float64(log[5])
	if used <= 255 {
		remaining := math.Max(0, 100-used)
		health.HealthPercent = &remaining
	}
	reasons := []string{}
	for bit, text := range []string{"available spare below threshold", "temperature threshold exceeded", "reliability degraded", "media placed in read-only mode", "volatile memory backup failed"} {
		if warning&(1<<bit) != 0 {
			reasons = append(reasons, text)
		}
	}
	if len(reasons) > 0 {
		health.Status = "bad"
		health.Reason = "NVMe critical warning: " + strings.Join(reasons, ", ")
	} else {
		health.Status = "good"
		health.Reason = "NVMe critical warning clear"
	}
	// IDs are the field offsets in the log page, which keeps them stable and
	// distinct without pretending NVMe has ATA attribute numbers.
	add := func(offset int, name string, value, threshold float64) {
		health.Attributes = append(health.Attributes, SMARTAttribute{ID: offset, Name: name, Value: value, Threshold: threshold})
	}
	add(0, "Critical Warning", float64(warning), 0)
	add(3, "Available Spare", spare, spareThreshold)
	add(5, "Percentage Used", used, 0)
	add(32, "Data Units Read", le128(log[32:48]), 0)
	add(48, "Data Units Written", le128(log[48:64]), 0)
	add(112, "Power Cycles", le128(log[112:128]), 0)
	add(128, "Power On Hours", le128(log[128:144]), 0)
	add(144, "Unsafe Shutdowns", le128(log[144:160]), 0)
	add(160, "Media and Data Integrity Errors", le128(log[160:176]), 0)
	add(176, "Error Information Log Entries", le128(log[176:192]), 0)
	return health, nil
}

var ataAttributeNames = map[int]string{
	1: "Raw Read Error Rate", 3: "Spin Up Time", 4: "Start Stop Count", 5: "Reallocated Sector Count",
	7: "Seek Error Rate", 9: "Power On Hours", 10: "Spin Retry Count", 12: "Power Cycle Count",
	169: "Remaining Lifetime", 173: "Wear Leveling Count", 177: "Wear Leveling Count", 181: "Program Fail Count",
	182: "Erase Fail Count", 187: "Reported Uncorrectable Errors", 188: "Command Timeout", 190: "Airflow Temperature",
	192: "Power-Off Retract Count", 194: "Temperature", 196: "Reallocation Event Count", 197: "Current Pending Sector Count",
	198: "Offline Uncorrectable", 199: "UDMA CRC Error Count", 231: "SSD Life Left", 233: "Media Wearout Indicator",
	241: "Total LBAs Written", 242: "Total LBAs Read",
}

// ParseATASMART decodes the 512-byte ATA SMART data and threshold pages. The
// attribute table (30 entries of 12 bytes from offset 2) is vendor defined but
// its framing is universal; values are reported as raw counters like smartctl.
func ParseATASMART(exceeded *bool, data, thresholds []byte) (DiskHealth, error) {
	if exceeded == nil && len(data) != 512 {
		return DiskHealth{}, errors.New("ATA SMART returned no status or data")
	}
	health := DiskHealth{Source: "ATA SMART"}
	if exceeded != nil {
		if *exceeded {
			health.Status, health.Reason = "bad", "ATA SMART threshold exceeded"
		} else {
			health.Status, health.Reason = "good", "ATA SMART status passed"
		}
	}
	limits := map[int]float64{}
	if len(thresholds) == 512 {
		for offset := 2; offset+12 <= 362; offset += 12 {
			if id := int(thresholds[offset]); id != 0 {
				limits[id] = float64(thresholds[offset+1])
			}
		}
	}
	if len(data) == 512 {
		for offset := 2; offset+12 <= 362; offset += 12 {
			id := int(data[offset])
			if id == 0 {
				continue
			}
			normalized := float64(data[offset+3])
			raw := uint64(0)
			for index := 5; index >= 0; index-- {
				raw = raw<<8 | uint64(data[offset+5+index])
			}
			name := ataAttributeNames[id]
			if name == "" {
				name = fmt.Sprintf("Attribute %d", id)
			}
			threshold := limits[id]
			health.Attributes = append(health.Attributes, SMARTAttribute{ID: id, Name: name, Value: float64(raw), Threshold: threshold})
			if (id == 194 || id == 190) && health.TemperatureC == nil {
				if celsius := float64(raw & 0xff); celsius > 0 && celsius < 150 {
					health.TemperatureC = &celsius
				}
			}
			if (id == 231 || id == 169 || id == 233) && health.HealthPercent == nil && normalized <= 100 {
				value := normalized
				health.HealthPercent = &value
			}
			if threshold > 0 && normalized <= threshold && health.Status != "bad" {
				health.Status, health.Reason = "bad", name+" at or below its failure threshold"
			}
		}
	}
	return health, nil
}

// ---------------------------------------------------------------- network

type NetworkInterface struct {
	BSDName, Model, Vendor, Class string
	LinkSpeed, LinkStatus         *float64
	Wireless                      bool
}

type WiFiInterface struct {
	BSDName             string
	PowerOn             bool
	RSSI, Noise, TxRate *float64
}

type NetworkReport struct {
	Interfaces []NetworkInterface
	Types      map[string]string
	WiFi       []WiFiInterface
	WiFiError  string
}

type NetworkInfo struct {
	Model          string
	LinkSpeedMbps  *float64
	ConnectionType string
	SignalPercent  *float64
	RSSIdBm        *float64
	NoisedBm       *float64
}

func ParseNetwork(raw []byte) (NetworkReport, error) {
	var report NetworkReport
	err := json.Unmarshal(raw, &report)
	return report, err
}

// SignalPercent maps RSSI linearly from -100 dBm (0%) to -50 dBm (100%), the
// same scale Windows uses for its WLAN signal quality.
func SignalPercent(rssi float64) float64 {
	return math.Max(0, math.Min(100, 2*(rssi+100)))
}

var scInterfaceTypes = map[string]string{
	"IEEE80211": "Wi-Fi", "Ethernet": "Ethernet", "Bridge": "Bridge", "Bond": "Bond", "VLAN": "VLAN",
	"Bluetooth": "Bluetooth", "FireWire": "FireWire", "PPP": "PPP", "WWAN": "Cellular", "Modem": "Modem",
}

func NetworkMetadata(report NetworkReport) map[string]NetworkInfo {
	result := map[string]NetworkInfo{}
	for _, item := range report.Interfaces {
		info := NetworkInfo{Model: item.Model}
		if item.Vendor != "" && item.Model != "" && !strings.Contains(strings.ToLower(item.Model), strings.ToLower(item.Vendor)) {
			info.Model = item.Vendor + " " + item.Model
		}
		info.ConnectionType = scInterfaceTypes[report.Types[item.BSDName]]
		switch {
		case item.Wireless:
			info.ConnectionType = "Wi-Fi"
		case strings.Contains(strings.ToLower(item.Class), "thunderbolt"):
			info.ConnectionType = "Thunderbolt"
		}
		// IOLinkStatus bit 0 = status valid, bit 1 = link active.
		active := item.LinkStatus == nil || int(*item.LinkStatus)&3 == 3
		if active && item.LinkSpeed != nil && *item.LinkSpeed > 0 {
			mbps := *item.LinkSpeed / 1e6
			info.LinkSpeedMbps = &mbps
		}
		result[item.BSDName] = info
	}
	for _, wifi := range report.WiFi {
		info := result[wifi.BSDName]
		info.ConnectionType = "Wi-Fi"
		if wifi.PowerOn && wifi.RSSI != nil && *wifi.RSSI < 0 && *wifi.RSSI > -120 {
			percent := SignalPercent(*wifi.RSSI)
			info.SignalPercent = &percent
			info.RSSIdBm = wifi.RSSI
			info.NoisedBm = wifi.Noise
			// Wi-Fi controllers publish no IOLinkSpeed; the negotiated PHY
			// transmit rate is the link rate.
			if wifi.TxRate != nil && *wifi.TxRate > 0 {
				info.LinkSpeedMbps = wifi.TxRate
			}
		} else {
			info.LinkSpeedMbps = nil
		}
		result[wifi.BSDName] = info
	}
	return result
}

// ---------------------------------------------------------------- system

type PerfLevel struct {
	Name              string
	Physical, Logical int
	L2, L3            uint64
}

type SystemReport struct {
	OpenFiles, Processes, ReadableProcesses, Threads *uint64
	PerfLevels                                       []PerfLevel
	L2, L3                                           *uint64
	ThermalPressure, MemoryPressure                  *int
}

func ParseSystem(raw []byte) (SystemReport, error) {
	var report SystemReport
	err := json.Unmarshal(raw, &report)
	return report, err
}

// ThermalPressureName decodes com.apple.system.thermalpressurelevel
// (OSThermalPressureLevel). Unknown values are not mapped.
func ThermalPressureName(level int) string {
	return map[int]string{0: "nominal", 1: "moderate", 2: "heavy", 3: "trapping", 4: "sleeping"}[level]
}

// MemoryPressureName decodes kern.memorystatus_vm_pressure_level.
func MemoryPressureName(level int) string {
	return map[int]string{1: "normal", 2: "warning", 4: "critical"}[level]
}

// ---------------------------------------------------------------- HID temperatures

type HIDSensor struct {
	Name  string
	Value float64
}

type HIDReport struct {
	Sensors []HIDSensor
	Error   string
}

type HIDTemperature struct {
	Name, Role string
	Value      float64
}

func ParseHID(raw []byte) (HIDReport, error) {
	var report HIDReport
	err := json.Unmarshal(raw, &report)
	return report, err
}

// ClassifyHID assigns roles from Apple's on-die sensor names. CPU and GPU means
// come from the cluster/die monitors only; storage, battery and unknown
// sensors are listed but never feed the CPU or GPU value.
func ClassifyHID(sensors []HIDSensor) (cpu, gpu *float64, list []HIDTemperature) {
	var clusters, dies, gpus []float64
	seen := map[string]int{}
	for _, sensor := range sensors {
		if sensor.Value <= 0 || sensor.Value >= 150 || math.IsNaN(sensor.Value) {
			continue
		}
		name := strings.TrimSpace(sensor.Name)
		lower := strings.ToLower(name)
		role := "unknown"
		switch {
		case strings.Contains(lower, "acc mtr temp") || strings.HasPrefix(lower, "pacc") || strings.HasPrefix(lower, "eacc"):
			// Cluster monitors, not individual cores.
			role = "cpu_package"
			clusters = append(clusters, sensor.Value)
		case strings.HasPrefix(lower, "pmu tdie") || strings.HasPrefix(lower, "pmu2 tdie"):
			role = "cpu_package"
			dies = append(dies, sensor.Value)
		case strings.Contains(lower, "gpu mtr temp"):
			role = "gpu_core"
			gpus = append(gpus, sensor.Value)
		case strings.Contains(lower, "nand"):
			role = "storage_sensor"
		}
		seen[name]++
		if seen[name] > 1 {
			name = fmt.Sprintf("%s #%d", name, seen[name])
		}
		list = append(list, HIDTemperature{Name: name, Role: role, Value: sensor.Value})
	}
	if len(clusters) > 0 {
		cpu = mean(clusters)
	} else if len(dies) > 0 {
		cpu = mean(dies)
	}
	if len(gpus) > 0 {
		gpu = mean(gpus)
	}
	sort.SliceStable(list, func(i, j int) bool { return list[i].Name < list[j].Name })
	return cpu, gpu, list
}

func mean(values []float64) *float64 {
	total := 0.0
	for _, value := range values {
		total += value
	}
	result := total / float64(len(values))
	return &result
}

// ---------------------------------------------------------------- IOReport energy and GPU states

type EnergyChannel struct {
	Name, Unit string
	Value      int64
}

type EnergyReport struct {
	Energy         []EnergyChannel
	EnergySeconds  float64
	EnergyError    string
	GPUStates      []FrequencyChannel
	GPUStatesError string
	GPUTable       string
}

type PowerBreakdown struct {
	CPU, GPU, ANE, DRAM, Media *float64
}

func ParseEnergy(raw []byte) (EnergyReport, error) {
	var report EnergyReport
	err := json.Unmarshal(raw, &report)
	return report, err
}

func energyJoules(value int64, unit string) (float64, bool) {
	scale := map[string]float64{"J": 1, "mJ": 1e-3, "uJ": 1e-6, "µJ": 1e-6, "nJ": 1e-9}[strings.TrimSpace(unit)]
	if scale == 0 || value < 0 {
		return 0, false
	}
	return float64(value) * scale, true
}

// PowerFromEnergy turns one IOReport "Energy Model" delta into average watts
// over the window. Only names with an established meaning are summed; a
// window with no matching channel leaves that component unavailable.
func PowerFromEnergy(channels []EnergyChannel, seconds float64) PowerBreakdown {
	result := PowerBreakdown{}
	if seconds <= 0 || seconds > 3600 {
		return result
	}
	add := func(target **float64, joules float64) {
		if *target == nil {
			zero := 0.0
			*target = &zero
		}
		**target += joules / seconds
	}
	for _, channel := range channels {
		joules, ok := energyJoules(channel.Value, channel.Unit)
		if !ok {
			continue
		}
		name := strings.TrimSpace(channel.Name)
		upper := strings.ToUpper(name)
		switch {
		case strings.HasSuffix(name, "CPU Energy"):
			add(&result.CPU, joules)
		case strings.HasSuffix(name, "GPU Energy"):
			add(&result.GPU, joules)
		case strings.HasPrefix(upper, "ANE"):
			add(&result.ANE, joules)
		case strings.HasPrefix(upper, "DRAM"):
			add(&result.DRAM, joules)
		case strings.HasPrefix(upper, "AVE") || strings.HasPrefix(upper, "AVD"):
			add(&result.Media, joules)
		}
	}
	for _, value := range []**float64{&result.CPU, &result.GPU, &result.ANE, &result.DRAM, &result.Media} {
		if *value != nil && (**value < 0 || **value > 2000 || math.IsNaN(**value)) {
			*value = nil
		}
	}
	return result
}

// ParseDVFSTable decodes a pmgr voltage-states table: 8-byte entries whose
// first little-endian word is the frequency (Hz on newer SoCs, kHz before).
// Leading zero (power-gated) entries are dropped; the rest must increase.
func ParseDVFSTable(raw []byte) []float64 {
	if len(raw) == 0 || len(raw)%8 != 0 || len(raw) > 128*8 {
		return nil
	}
	table := []float64{}
	previous := 0.0
	for offset := 0; offset < len(raw); offset += 8 {
		frequency := binary.LittleEndian.Uint32(raw[offset : offset+4])
		if frequency == 0 && len(table) == 0 {
			continue
		}
		mhz := float64(frequency) / 1000
		if frequency >= 100_000_000 {
			mhz = float64(frequency) / 1_000_000
		}
		if mhz < 100 || mhz > 10_000 || mhz <= previous {
			return nil
		}
		table = append(table, mhz)
		previous = mhz
	}
	return table
}

// GPUFrequency is the residency-weighted mean of the active GPU performance
// states. Apple names them by position (P1..Pn), so the mapping is accepted
// only when the active state count equals the DVFS table length.
func GPUFrequency(channels []FrequencyChannel, table []float64) *float64 {
	if len(table) == 0 {
		return nil
	}
	var weighted, total float64
	for _, channel := range channels {
		active := []State{}
		for _, state := range channel.States {
			switch strings.ToUpper(strings.TrimSpace(state.Name)) {
			case "IDLE", "OFF", "DOWN":
				continue
			}
			active = append(active, state)
		}
		if len(active) != len(table) {
			continue
		}
		for index, state := range active {
			if state.Residency < 0 {
				return nil
			}
			weighted += table[index] * float64(state.Residency)
			total += float64(state.Residency)
		}
	}
	if total == 0 {
		return nil
	}
	result := weighted / total
	return &result
}

// ---------------------------------------------------------------- battery and power adapter

type PowerSourcesReport struct {
	Providing    string
	Battery      map[string]any
	AdapterWatts *float64
	SmartBattery map[string]any
}

type BatteryInfo struct {
	ChargePercent, HealthPercent, TemperatureC, VoltageV, AmperageMA, NetPowerWatts *float64
	TimeRemainingMinutes, DesignCapacityMAh, FullChargeCapacityMAh                  *float64
	CycleCount                                                                      *int
	Charging, ExternalPower, FullyCharged                                           *bool
	Condition                                                                       string
}

func ParsePowerSources(raw []byte) (PowerSourcesReport, error) {
	var report PowerSourcesReport
	err := json.Unmarshal(raw, &report)
	return report, err
}

func numberAt(values map[string]any, key string) (float64, bool) {
	value, ok := values[key].(float64)
	return value, ok && !math.IsNaN(value) && !math.IsInf(value, 0)
}

func boolAt(values map[string]any, key string) *bool {
	switch value := values[key].(type) {
	case bool:
		return &value
	case float64:
		result := value != 0
		return &result
	}
	return nil
}

func ptr(value float64) *float64 { return &value }

// Battery projects IOPowerSources and AppleSmartBattery. It returns nil on a
// machine without an internal battery; individual fields stay nil when the
// model does not publish them.
func Battery(report PowerSourcesReport) *BatteryInfo {
	if report.Battery == nil && report.SmartBattery == nil {
		return nil
	}
	if present := boolAt(report.Battery, "Is Present"); present != nil && !*present {
		return nil
	}
	info := &BatteryInfo{}
	ps, smart := report.Battery, report.SmartBattery
	if current, ok := numberAt(ps, "Current Capacity"); ok {
		if maximum, ok := numberAt(ps, "Max Capacity"); ok && maximum > 0 {
			info.ChargePercent = ptr(math.Max(0, math.Min(100, current/maximum*100)))
		}
	}
	info.Charging = boolAt(ps, "Is Charging")
	if info.Charging == nil {
		info.Charging = boolAt(smart, "IsCharging")
	}
	info.FullyCharged = boolAt(ps, "Is Charged")
	if info.FullyCharged == nil {
		info.FullyCharged = boolAt(smart, "FullyCharged")
	}
	if report.Providing != "" {
		external := report.Providing == "AC Power"
		info.ExternalPower = &external
	} else {
		info.ExternalPower = boolAt(smart, "ExternalConnected")
	}
	if cycles, ok := numberAt(smart, "CycleCount"); ok && cycles >= 0 && cycles < 100_000 {
		value := int(cycles)
		info.CycleCount = &value
	}
	if design, ok := numberAt(smart, "DesignCapacity"); ok && design > 0 {
		info.DesignCapacityMAh = ptr(design)
	}
	// Apple Silicon publishes MaxCapacity as a percentage and the real value
	// as AppleRawMaxCapacity; Intel publishes mAh in MaxCapacity.
	for _, key := range []string{"AppleRawMaxCapacity", "MaxCapacity", "NominalChargeCapacity"} {
		if value, ok := numberAt(smart, key); ok && value > 100 {
			info.FullChargeCapacityMAh = ptr(value)
			break
		}
	}
	if info.FullChargeCapacityMAh != nil && info.DesignCapacityMAh != nil {
		info.HealthPercent = ptr(math.Min(100, *info.FullChargeCapacityMAh / *info.DesignCapacityMAh * 100))
	}
	if raw, ok := numberAt(smart, "Temperature"); ok {
		if celsius := raw / 100; celsius > -30 && celsius < 100 {
			info.TemperatureC = ptr(celsius)
		}
	}
	if raw, ok := numberAt(smart, "Voltage"); ok && raw > 0 && raw < 30_000 {
		info.VoltageV = ptr(raw / 1000)
	}
	for _, key := range []string{"InstantAmperage", "Amperage"} {
		raw, ok := numberAt(smart, key)
		if !ok {
			continue
		}
		// A 16-bit two's complement register surfaced as an unsigned number.
		if raw > 32767 && raw <= 65535 {
			raw -= 65536
		}
		if math.Abs(raw) < 20_000 {
			info.AmperageMA = ptr(raw)
			break
		}
	}
	if info.VoltageV != nil && info.AmperageMA != nil {
		info.NetPowerWatts = ptr(*info.VoltageV * *info.AmperageMA / 1000)
	}
	key := "Time to Empty"
	if info.Charging != nil && *info.Charging {
		key = "Time to Full Charge"
	}
	if minutes, ok := numberAt(ps, key); ok && minutes >= 0 && minutes < 24*60*7 {
		info.TimeRemainingMinutes = ptr(minutes)
	}
	if condition, ok := ps["BatteryHealth"].(string); ok {
		info.Condition = condition
	}
	if failure, ok := numberAt(smart, "PermanentFailureStatus"); ok && failure != 0 {
		info.Condition = "Service Recommended"
	}
	return info
}

// ---------------------------------------------------------------- memory hardware

type MemoryHardware struct {
	SpeedMHz           *float64
	SlotCount          *int
	FormFactor         string
	Type, Manufacturer string
}

// ParseMemoryProfile reads `system_profiler SPMemoryDataType -json`. Intel
// Macs list DIMM slots; Apple silicon lists one on-package memory entry that
// has a type and manufacturer but no speed or slot.
func ParseMemoryProfile(raw []byte) (MemoryHardware, bool) {
	var report struct {
		SPMemoryDataType []map[string]any `json:"SPMemoryDataType"`
	}
	if err := json.Unmarshal(raw, &report); err != nil || len(report.SPMemoryDataType) == 0 {
		return MemoryHardware{}, false
	}
	result := MemoryHardware{}
	root := report.SPMemoryDataType[0]
	items, _ := root["_items"].([]any)
	if len(items) == 0 {
		// Apple silicon: the entry itself describes the package memory.
		text := func(key string) string {
			value, _ := root[key].(string)
			return strings.TrimSpace(value)
		}
		result.Type, result.Manufacturer = text("dimm_type"), text("dimm_manufacturer")
		if result.Type == "" && result.Manufacturer == "" {
			return MemoryHardware{}, false
		}
		result.FormFactor = "On-package"
		return result, true
	}
	populated := 0
	speeds := []float64{}
	for _, raw := range items {
		item, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		size, _ := item["dimm_size"].(string)
		if size == "" || strings.EqualFold(size, "empty") {
			continue
		}
		populated++
		if speedText, _ := item["dimm_speed"].(string); speedText != "" {
			if value, err := strconv.ParseFloat(strings.Fields(speedText)[0], 64); err == nil && value > 0 {
				speeds = append(speeds, value)
			}
		}
		if result.Type == "" {
			result.Type, _ = item["dimm_type"].(string)
		}
		if result.Manufacturer == "" {
			result.Manufacturer, _ = item["dimm_manufacturer"].(string)
		}
	}
	if populated == 0 {
		return MemoryHardware{}, false
	}
	result.SlotCount = &populated
	if len(speeds) > 0 {
		result.SpeedMHz = mean(speeds)
	}
	return result, true
}

// ---------------------------------------------------------------- per-process GPU time

func ParseGPUClients(raw []byte) (map[int32]uint64, bool, error) {
	var report struct {
		Accelerators, Clients int
		GPUTime               map[string]uint64
	}
	if err := json.Unmarshal(raw, &report); err != nil {
		return nil, false, err
	}
	result := make(map[int32]uint64, len(report.GPUTime))
	for key, value := range report.GPUTime {
		pid, err := strconv.ParseInt(key, 10, 32)
		if err == nil && pid > 0 {
			result[int32(pid)] = value
		}
	}
	return result, report.Clients > 0, nil
}
