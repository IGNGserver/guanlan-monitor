package macos

import (
	"encoding/binary"
	"encoding/hex"
	"math"
	"testing"
)

func TestAPFSIdentityResolvesMountsDiskutilDoesNotPublish(t *testing.T) {
	// Real `diskutil apfs list -plist` output has no MountPoint keys.
	data := []byte(`{"Containers":[
		{"APFSContainerUUID":"boot","CapacityCeiling":1000,"CapacityFree":400,"PhysicalStores":[{"DeviceIdentifier":"disk2s2"}],
		 "Volumes":[{"DeviceIdentifier":"disk3s1","Name":"Macintosh HD - Data","Roles":["Data"]},{"DeviceIdentifier":"disk3s2","Name":"Preboot","Roles":["Preboot"]},{"DeviceIdentifier":"disk3s4","Name":"Macintosh HD","Roles":["System"]}]},
		{"APFSContainerUUID":"usb","CapacityCeiling":500,"CapacityFree":100,"Volumes":[{"DeviceIdentifier":"disk8s1","Name":"Backup","Roles":[]}]},
		{"APFSContainerUUID":"cryptex","CapacityCeiling":4,"CapacityFree":0,"Volumes":[{"DeviceIdentifier":"disk7s1","Name":"Cryptex","Roles":[]}]}]}`)
	containers, err := ParseAPFS(data)
	if err != nil || len(containers) != 3 {
		t.Fatalf("containers=%v err=%v", containers, err)
	}
	mounts := map[string]string{"disk3s4s1": "/", "disk3s1": "/System/Volumes/Data", "disk3s2": "/System/Volumes/Preboot", "disk8s1": "/Volumes/Backup", "disk7s1": "/System/Library/AssetsV2/x"}
	if id, name, mount := APFSIdentity(containers[0], mounts); id != "apfs-boot" || name != "Macintosh HD" || mount != "/" {
		t.Fatalf("boot identity: %s %q %q", id, name, mount)
	}
	if _, name, mount := APFSIdentity(containers[1], mounts); name != "Backup" || mount != "/Volumes/Backup" {
		t.Fatalf("external identity: %q %q", name, mount)
	}
	if _, _, mount := APFSIdentity(containers[2], mounts); mount != "" {
		t.Fatalf("system asset container reported as a disk: %q", mount)
	}
	// A data volume alone still identifies the boot container.
	if _, name, mount := APFSIdentity(containers[0], map[string]string{"disk3s1": "/System/Volumes/Data"}); name != "Macintosh HD" || mount != "/" {
		t.Fatalf("data-only identity: %q %q", name, mount)
	}
	if _, _, mount := APFSIdentity(containers[0], map[string]string{"disk3s4x1": "/"}); mount != "" {
		t.Fatal("matched a non-snapshot device suffix")
	}
}

func nvmeLog() []byte {
	log := make([]byte, 512)
	binary.LittleEndian.PutUint16(log[1:3], 273+38)
	log[3], log[4], log[5] = 100, 10, 3
	binary.LittleEndian.PutUint64(log[32:40], 1000)
	binary.LittleEndian.PutUint64(log[128:136], 4321)
	binary.LittleEndian.PutUint64(log[48:56], 7)
	binary.LittleEndian.PutUint64(log[56:64], 1) // 2^64 + 7 data units written
	return log
}

func TestNVMeSMARTDecodesLogPage(t *testing.T) {
	health, err := ParseNVMeSMART(nvmeLog())
	if err != nil {
		t.Fatal(err)
	}
	if health.TemperatureC == nil || *health.TemperatureC != 38 || health.HealthPercent == nil || *health.HealthPercent != 97 || health.Status != "good" {
		t.Fatalf("health=%+v", health)
	}
	values := map[string]SMARTAttribute{}
	for _, attribute := range health.Attributes {
		values[attribute.Name] = attribute
	}
	if values["Power On Hours"].Value != 4321 || values["Data Units Read"].Value != 1000 || values["Available Spare"].Threshold != 10 {
		t.Fatalf("attributes=%+v", values)
	}
	if written := values["Data Units Written"].Value; written != math.Pow(2, 64)+7 {
		t.Fatalf("128-bit counter=%v", written)
	}
	log := nvmeLog()
	log[0] = 0b1001
	health, _ = ParseNVMeSMART(log)
	if health.Status != "bad" || health.Reason != "NVMe critical warning: available spare below threshold, media placed in read-only mode" {
		t.Fatalf("warning=%+v", health)
	}
	log = nvmeLog()
	log[1], log[2] = 0, 0
	health, _ = ParseNVMeSMART(log)
	if health.TemperatureC != nil {
		t.Fatal("invented a temperature from a zero Kelvin field")
	}
	if _, err := ParseNVMeSMART(make([]byte, 100)); err == nil {
		t.Fatal("accepted truncated log")
	}
}

func ataPages(entries [][4]int) ([]byte, []byte) {
	data, thresholds := make([]byte, 512), make([]byte, 512)
	for index, entry := range entries {
		offset := 2 + index*12
		data[offset] = byte(entry[0])
		data[offset+3] = byte(entry[1])
		binary.LittleEndian.PutUint32(data[offset+5:offset+9], uint32(entry[2]))
		thresholds[offset] = byte(entry[0])
		thresholds[offset+1] = byte(entry[3])
	}
	return data, thresholds
}

func TestATASMARTDecodesAttributeTable(t *testing.T) {
	passed := false
	data, thresholds := ataPages([][4]int{{5, 100, 3, 36}, {9, 99, 1200, 0}, {194, 64, 0x2a002a1f, 0}, {231, 88, 88, 10}})
	health, err := ParseATASMART(&passed, data, thresholds)
	if err != nil || health.Status != "good" || health.TemperatureC == nil || *health.TemperatureC != 31 || health.HealthPercent == nil || *health.HealthPercent != 88 {
		t.Fatalf("health=%+v err=%v", health, err)
	}
	if len(health.Attributes) != 4 || health.Attributes[0].Name != "Reallocated Sector Count" || health.Attributes[0].Value != 3 || health.Attributes[0].Threshold != 36 {
		t.Fatalf("attributes=%+v", health.Attributes)
	}
	failing, _ := ataPages([][4]int{{5, 30, 900, 36}})
	health, _ = ParseATASMART(&passed, failing, thresholds)
	if health.Status != "bad" {
		t.Fatalf("attribute below threshold not reported: %+v", health)
	}
	exceeded := true
	health, _ = ParseATASMART(&exceeded, nil, nil)
	if health.Status != "bad" || len(health.Attributes) != 0 {
		t.Fatalf("status-only=%+v", health)
	}
	if _, err := ParseATASMART(nil, nil, nil); err == nil {
		t.Fatal("accepted a device that returned nothing")
	}
}

func TestStorageInventorySkipsVirtualDisksAndMapsInterfaces(t *testing.T) {
	devices, err := ParseStorage([]byte(`[
		{"BSDName":"disk0","Product":"APPLE SSD AP0512Q","Vendor":"Apple","Interconnect":"Apple Fabric","Location":"Internal","NVMe":{"Log":"` + hex.EncodeToString(nvmeLog()) + `"}},
		{"BSDName":"disk3","Interconnect":"Virtual Interface"},
		{"BSDName":"disk4","Product":"Samsung T7","Vendor":"Samsung","Interconnect":"USB","Location":"External"},
		{"BSDName":"disk5","Product":"WDC WD40","Interconnect":"SATA","Location":"External","ATA":{"Error":"ATA SMART user client unavailable"}},
		{"BSDName":"disk6","Product":"X","Interconnect":"PCI-Express","NVMe":{"Error":"not sampled"}}]`))
	if err != nil {
		t.Fatal(err)
	}
	inventory := StorageInventory(devices)
	if _, ok := inventory["disk3"]; ok {
		t.Fatal("virtual APFS disk listed as hardware")
	}
	internal := inventory["disk0"]
	// "APPLE SSD ..." already names its vendor; it is not repeated.
	if internal.InterfaceType != "NVMe" || internal.Vendor != "" || internal.Health == nil || *internal.Health.TemperatureC != 38 {
		t.Fatalf("internal=%+v", internal)
	}
	if inventory["disk4"].InterfaceType != "USB" || inventory["disk4"].Vendor != "" || inventory["disk4"].Health != nil {
		t.Fatalf("usb=%+v", inventory["disk4"])
	}
	if inventory["disk5"].InterfaceType != "SATA (external)" || inventory["disk5"].HealthError == "" {
		t.Fatalf("sata=%+v", inventory["disk5"])
	}
	if inventory["disk6"].Health != nil || inventory["disk6"].HealthError != "not sampled" {
		t.Fatalf("unsampled=%+v", inventory["disk6"])
	}
}

func TestNetworkMetadataUsesLinkStateAndWiFiSignal(t *testing.T) {
	report, err := ParseNetwork([]byte(`{
		"Interfaces":[
			{"BSDName":"en0","Model":"Wi-Fi","Vendor":"Apple","Class":"AppleBCMWLANSkywalkInterface","LinkSpeed":0,"LinkStatus":3,"Wireless":true},
			{"BSDName":"en1","Model":"Ethernet","Vendor":"Apple","LinkSpeed":2500000000,"LinkStatus":3,"Wireless":false},
			{"BSDName":"en2","Model":"Ethernet","Vendor":"Apple","LinkSpeed":1000000000,"LinkStatus":1,"Wireless":false},
			{"BSDName":"en5","Model":"Thunderbolt Ethernet Slot 0","Class":"IOThunderboltEthernetInterface","LinkSpeed":10000000000,"Wireless":false}],
		"Types":{"en1":"Ethernet","en2":"Ethernet","en5":"Ethernet"},
		"WiFi":[{"BSDName":"en0","PowerOn":true,"RSSI":-61,"Noise":-92,"TxRate":866.7}]}`))
	if err != nil {
		t.Fatal(err)
	}
	meta := NetworkMetadata(report)
	wifi := meta["en0"]
	if wifi.ConnectionType != "Wi-Fi" || wifi.SignalPercent == nil || *wifi.SignalPercent != 78 || *wifi.LinkSpeedMbps != 866.7 || *wifi.NoisedBm != -92 || wifi.Model != "Apple Wi-Fi" {
		t.Fatalf("wifi=%+v", wifi)
	}
	if meta["en1"].ConnectionType != "Ethernet" || *meta["en1"].LinkSpeedMbps != 2500 {
		t.Fatalf("ethernet=%+v", meta["en1"])
	}
	if meta["en2"].LinkSpeedMbps != nil {
		t.Fatal("reported a speed for a link that is down")
	}
	if meta["en5"].ConnectionType != "Thunderbolt" || *meta["en5"].LinkSpeedMbps != 10000 {
		t.Fatalf("thunderbolt=%+v", meta["en5"])
	}
	off := NetworkMetadata(NetworkReport{WiFi: []WiFiInterface{{BSDName: "en0", PowerOn: false}}})
	if off["en0"].SignalPercent != nil || off["en0"].LinkSpeedMbps != nil {
		t.Fatal("invented a signal for a powered-off radio")
	}
	for rssi, want := range map[float64]float64{-30: 100, -50: 100, -75: 50, -100: 0, -110: 0} {
		if got := SignalPercent(rssi); got != want {
			t.Fatalf("SignalPercent(%v)=%v", rssi, got)
		}
	}
}

func TestClassifyHIDKeepsRolesApart(t *testing.T) {
	cpu, gpu, list := ClassifyHID([]HIDSensor{
		{"pACC MTR Temp Sensor0", 50}, {"eACC MTR Temp Sensor0", 40}, {"PMU tdie1", 80},
		{"GPU MTR Temp Sensor1", 45}, {"NAND CH0 temp", 33}, {"gas gauge battery", 30}, {"bogus", 0}, {"bogus", 200},
	})
	if cpu == nil || *cpu != 45 || gpu == nil || *gpu != 45 || len(list) != 6 {
		t.Fatalf("cpu=%v gpu=%v list=%+v", cpu, gpu, list)
	}
	roles := map[string]string{}
	for _, item := range list {
		roles[item.Name] = item.Role
	}
	if roles["NAND CH0 temp"] != "storage_sensor" || roles["gas gauge battery"] != "unknown" || roles["GPU MTR Temp Sensor1"] != "gpu_core" {
		t.Fatalf("roles=%v", roles)
	}
	// Die sensors are the CPU fallback only when no cluster monitor exists.
	cpu, gpu, _ = ClassifyHID([]HIDSensor{{"PMU tdie1", 60}, {"PMU tdie2", 70}})
	if cpu == nil || *cpu != 65 || gpu != nil {
		t.Fatalf("die fallback cpu=%v gpu=%v", cpu, gpu)
	}
	if cpu, gpu, list := ClassifyHID(nil); cpu != nil || gpu != nil || len(list) != 0 {
		t.Fatal("invented values from no sensors")
	}
}

func TestPowerFromEnergyConvertsUnitsAndWindow(t *testing.T) {
	power := PowerFromEnergy([]EnergyChannel{
		{"CPU Energy", "mJ", 4000}, {"DIE_1_CPU Energy", "mJ", 1000}, {"GPU Energy", "mJ", 2000}, {"GPU SRAM", "mJ", 999},
		{"ANE0", "mJ", 500}, {"DRAM0", "uJ", 1_000_000}, {"AVE0", "nJ", 2_000_000_000}, {"ECPU0", "mJ", 77}, {"Weird", "furlongs", 5},
	}, 2)
	check := func(name string, value *float64, want float64) {
		if value == nil || math.Abs(*value-want) > 1e-9 {
			t.Fatalf("%s=%v want %v", name, value, want)
		}
	}
	check("cpu", power.CPU, 2.5)
	check("gpu", power.GPU, 1)
	check("ane", power.ANE, 0.25)
	check("dram", power.DRAM, 0.5)
	check("media", power.Media, 1)
	if empty := PowerFromEnergy([]EnergyChannel{{"CPU Energy", "mJ", 1}}, 0); empty.CPU != nil {
		t.Fatal("produced watts without a window")
	}
	if none := PowerFromEnergy([]EnergyChannel{{"CPU Energy", "mJ", -5}}, 1); none.CPU != nil {
		t.Fatal("accepted a negative energy delta")
	}
}

func dvfs(values ...uint32) []byte {
	raw := make([]byte, 8*len(values))
	for index, value := range values {
		binary.LittleEndian.PutUint32(raw[index*8:], value)
	}
	return raw
}

func TestDVFSTableAndGPUFrequency(t *testing.T) {
	table := ParseDVFSTable(dvfs(0, 396_000_000, 720_000_000, 1_278_000_000))
	if len(table) != 3 || table[0] != 396 || table[2] != 1278 {
		t.Fatalf("table=%v", table)
	}
	if kHz := ParseDVFSTable(dvfs(600_000, 1_200_000)); len(kHz) != 2 || kHz[1] != 1200 {
		t.Fatalf("kHz table=%v", kHz)
	}
	if ParseDVFSTable(dvfs(720_000_000, 396_000_000)) != nil || ParseDVFSTable([]byte{1, 2, 3}) != nil {
		t.Fatal("accepted a non-increasing or malformed table")
	}
	channels := []FrequencyChannel{{Name: "GPUPH", States: []State{{Name: "OFF", Residency: 500}, {Name: "IDLE", Residency: 100}, {Name: "P1", Residency: 1}, {Name: "P2", Residency: 0}, {Name: "P3", Residency: 3}}}}
	if value := GPUFrequency(channels, table); value == nil || *value != (396+3*1278)/4.0 {
		t.Fatalf("gpu frequency=%v", value)
	}
	if GPUFrequency(channels, table[:2]) != nil {
		t.Fatal("mapped states onto a table of a different length")
	}
	idle := []FrequencyChannel{{States: []State{{Name: "OFF", Residency: 9}, {Name: "P1", Residency: 0}, {Name: "P2", Residency: 0}, {Name: "P3", Residency: 0}}}}
	if GPUFrequency(idle, table) != nil {
		t.Fatal("reported a clock for an idle GPU window")
	}
}

func TestBatteryProjection(t *testing.T) {
	report, err := ParsePowerSources([]byte(`{"Providing":"Battery Power",
		"Battery":{"Current Capacity":80,"Max Capacity":100,"Is Charging":false,"Is Charged":false,"Time to Empty":245,"BatteryHealth":"Good"},
		"SmartBattery":{"CycleCount":312,"DesignCapacity":6075,"MaxCapacity":100,"AppleRawMaxCapacity":5164,"Temperature":3055,"Voltage":12450,"Amperage":64536,"PermanentFailureStatus":0}}`))
	if err != nil {
		t.Fatal(err)
	}
	battery := Battery(report)
	if battery == nil || *battery.ChargePercent != 80 || *battery.CycleCount != 312 || *battery.FullChargeCapacityMAh != 5164 ||
		math.Abs(*battery.HealthPercent-85.0041) > 0.001 || *battery.TemperatureC != 30.55 || *battery.VoltageV != 12.45 ||
		*battery.AmperageMA != -1000 || math.Abs(*battery.NetPowerWatts+12.45) > 1e-9 || *battery.TimeRemainingMinutes != 245 ||
		*battery.ExternalPower || *battery.Charging || battery.Condition != "Good" {
		t.Fatalf("battery: charge=%v cycles=%v full=%v health=%v temp=%v volt=%v amp=%v net=%v time=%v ext=%v chg=%v cond=%q",
			*battery.ChargePercent, *battery.CycleCount, *battery.FullChargeCapacityMAh, *battery.HealthPercent, *battery.TemperatureC,
			*battery.VoltageV, *battery.AmperageMA, *battery.NetPowerWatts, *battery.TimeRemainingMinutes, *battery.ExternalPower, *battery.Charging, battery.Condition)
	}
	intel := Battery(PowerSourcesReport{Providing: "AC Power", SmartBattery: map[string]any{"MaxCapacity": 4000.0, "DesignCapacity": 5000.0, "PermanentFailureStatus": 2.0}, Battery: map[string]any{"Is Charging": true, "Time to Full Charge": -1.0}})
	if *intel.FullChargeCapacityMAh != 4000 || *intel.HealthPercent != 80 || !*intel.ExternalPower || intel.TimeRemainingMinutes != nil || intel.Condition != "Service Recommended" {
		t.Fatalf("intel battery=%+v", intel)
	}
	if Battery(PowerSourcesReport{Providing: "AC Power"}) != nil {
		t.Fatal("desktop reported a battery")
	}
	if Battery(PowerSourcesReport{Battery: map[string]any{"Is Present": false}}) != nil {
		t.Fatal("removed battery reported")
	}
}

func TestMemoryProfileIntelAndAppleSilicon(t *testing.T) {
	intel, ok := ParseMemoryProfile([]byte(`{"SPMemoryDataType":[{"_items":[
		{"_name":"DIMM1","dimm_size":"16 GB","dimm_speed":"2666 MHz","dimm_type":"DDR4","dimm_manufacturer":"Micron"},
		{"_name":"DIMM2","dimm_size":"empty","dimm_speed":"empty"},
		{"_name":"DIMM3","dimm_size":"16 GB","dimm_speed":"2933 MHz","dimm_type":"DDR4"}]}]}`))
	if !ok || *intel.SlotCount != 2 || *intel.SpeedMHz != 2799.5 || intel.Type != "DDR4" || intel.Manufacturer != "Micron" || intel.FormFactor != "" {
		t.Fatalf("intel=%+v", intel)
	}
	apple, ok := ParseMemoryProfile([]byte(`{"SPMemoryDataType":[{"SPMemoryDataType":"16 GB","dimm_manufacturer":"Hynix","dimm_type":"LPDDR5"}]}`))
	if !ok || apple.SlotCount != nil || apple.SpeedMHz != nil || apple.FormFactor != "On-package" || apple.Type != "LPDDR5" {
		t.Fatalf("apple=%+v", apple)
	}
	if _, ok := ParseMemoryProfile([]byte(`{"SPMemoryDataType":[]}`)); ok {
		t.Fatal("accepted empty profile")
	}
}

func TestPressureNames(t *testing.T) {
	if ThermalPressureName(0) != "nominal" || ThermalPressureName(2) != "heavy" || ThermalPressureName(9) != "" {
		t.Fatal("thermal pressure mapping")
	}
	if MemoryPressureName(1) != "normal" || MemoryPressureName(4) != "critical" || MemoryPressureName(3) != "" {
		t.Fatal("memory pressure mapping")
	}
}
