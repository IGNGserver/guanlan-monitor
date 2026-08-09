package main

import (
	"encoding/json"
	"testing"
)

func TestParsePVESizeBytes(t *testing.T) {
	tests := map[string]uint64{
		"32G":  32 * 1024 * 1024 * 1024,
		"512M": 512 * 1024 * 1024,
		"1.5T": uint64(1.5 * 1024 * 1024 * 1024 * 1024),
		"":     0,
		"bad":  0,
	}
	for input, expected := range tests {
		if actual := parsePVESizeBytes(input); actual != expected {
			t.Fatalf("parsePVESizeBytes(%q) = %d, want %d", input, actual, expected)
		}
	}
}

func TestParseProxmoxVMConfig(t *testing.T) {
	config := map[string]json.RawMessage{
		"scsi0": json.RawMessage(`"local-lvm:vm-200-disk-0,size=32G,ssd=1"`),
		"net0":  json.RawMessage(`"virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0,tag=20"`),
		"ide2":  json.RawMessage(`"local:iso/test.iso,media=cdrom"`),
	}
	disks, networks := parseProxmoxVMConfig(200, config)
	if len(disks) != 1 {
		t.Fatalf("got %d disks, want 1", len(disks))
	}
	if disks[0].Storage != "local-lvm" || disks[0].Path != "vm-200-disk-0" || disks[0].CapacityBytes == nil {
		t.Fatalf("unexpected disk: %#v", disks[0])
	}
	if len(networks) != 1 {
		t.Fatalf("got %d networks, want 1", len(networks))
	}
	if networks[0].MACAddress != "AA:BB:CC:DD:EE:FF" || networks[0].Bridge != "vmbr0" || networks[0].VLAN == nil || *networks[0].VLAN != 20 {
		t.Fatalf("unexpected network: %#v", networks[0])
	}
}

func TestPVEUsagePercent(t *testing.T) {
	if actual := pveUsagePercent(0.25); actual != 25 {
		t.Fatalf("fractional usage = %v, want 25", actual)
	}
	if actual := pveUsagePercent(125); actual != 100 {
		t.Fatalf("clamped usage = %v, want 100", actual)
	}
}

func TestParseLibvirtDomainInfo(t *testing.T) {
	output := `Id:             7
Name:           nested-linux
UUID:           11111111-2222-3333-4444-555555555555
OS Type:        hvm
State:          running
CPU(s):         4
Max memory:     8388608 KiB
Used memory:    4194304 KiB
`
	node := parseLibvirtNodeInfo(output, "libvirt")
	if node.CPU == nil || node.CPU.ConfiguredCores == nil || *node.CPU.ConfiguredCores != 4 {
		t.Fatalf("unexpected node parser result: %#v", node)
	}
	fields := parseColonFields(output)
	if normalizeLibvirtPowerState(fields["State"]) != "running" {
		t.Fatalf("unexpected state: %q", fields["State"])
	}
	if parseLibvirtBytes(fields["Max memory"]) != 8*1024*1024*1024 {
		t.Fatalf("unexpected max memory: %q", fields["Max memory"])
	}
}

func TestParseLibvirtDeviceLists(t *testing.T) {
	blocks := `Type       Device     Target     Source
------------------------------------------------
file       disk       vda        /var/lib/libvirt/images/nested.qcow2
file       cdrom      sda        /var/lib/libvirt/images/debian.iso
`
	disks := parseLibvirtBlockList(blocks)
	if len(disks) != 1 || disks[0].Name != "vda" || disks[0].Path != "/var/lib/libvirt/images/nested.qcow2" {
		t.Fatalf("unexpected disks: %#v", disks)
	}

	interfaces := `Interface  Type       Source     Model       MAC
------------------------------------------------------------
vnet0      bridge     virbr0     virtio      52:54:00:aa:bb:cc
`
	networks := parseLibvirtInterfaceList(interfaces)
	if len(networks) != 1 || networks[0].SwitchName != "virbr0" || networks[0].MACAddress != "52:54:00:aa:bb:cc" {
		t.Fatalf("unexpected networks: %#v", networks)
	}
}

func TestParseLibvirtStats(t *testing.T) {
	vm := virtualMachineTelemetry{
		CPU:    &virtualizationCPUStats{},
		Memory: &virtualizationMemoryStats{},
	}
	applyLibvirtDomainStats(&vm, libvirtDomainStats{Values: map[string]uint64{
		"balloon.maximum":  4096,
		"balloon.current":  2048,
		"vcpu.current":     2,
		"block.0.rd.bytes": 100,
		"block.0.wr.bytes": 200,
		"net.0.rx.bytes":   300,
		"net.0.tx.bytes":   400,
	}})
	if vm.CPU.ConfiguredCores == nil || *vm.CPU.ConfiguredCores != 2 {
		t.Fatalf("unexpected CPU stats: %#v", vm.CPU)
	}
	if vm.Memory.ConfiguredBytes == nil || *vm.Memory.ConfiguredBytes != 4096*1024 {
		t.Fatalf("unexpected memory stats: %#v", vm.Memory)
	}
	if vm.Disk == nil || vm.Disk.TotalReadBytes == nil || *vm.Disk.TotalReadBytes != 100 {
		t.Fatalf("unexpected disk stats: %#v", vm.Disk)
	}
	if vm.Network == nil || vm.Network.TotalTxBytes == nil || *vm.Network.TotalTxBytes != 400 {
		t.Fatalf("unexpected network stats: %#v", vm.Network)
	}
}

func TestParseLibvirtPercent(t *testing.T) {
	if actual := parseFloatField("12.5%"); actual != 12.5 {
		t.Fatalf("unexpected libvirt percentage: %v", actual)
	}
}

func TestNormalizeHyperVValues(t *testing.T) {
	if normalizeHyperVPowerState("Running") != "running" || normalizeHyperVPowerState("Off") != "stopped" {
		t.Fatalf("unexpected Hyper-V power state normalization")
	}
	if normalizeMACAddress("0015-5D1F-C316") != "00:15:5D:1F:C3:16" {
		t.Fatalf("unexpected Hyper-V MAC normalization")
	}
}

func TestParseVirtualBoxMachineData(t *testing.T) {
	entries := parseVirtualBoxVMList(`"nested" {11111111-2222-3333-4444-555555555555}`)
	if len(entries) != 1 || entries[0].name != "nested" || entries[0].id != "11111111-2222-3333-4444-555555555555" {
		t.Fatalf("unexpected VirtualBox VM list: %#v", entries)
	}
	fields := parseVirtualBoxMachineReadable("name=\"nested\"\nVMState=\"running\"\ncpus=\"2\"\nmemory=\"4096\"\nSATA-0-0=\"/tmp/nested.vdi\"\nSATA-0-0-type=\"hdd\"\nnic1=\"bridged\"\nmacaddress1=\"001122334455\"\nbridgeadapter1=\"vmbr0\"")
	if fields["VMState"] != `"running"` || fields["SATA-0-0"] != `"/tmp/nested.vdi"` {
		t.Fatalf("unexpected VirtualBox machine-readable values: %#v", fields)
	}
	if !isVirtualBoxDiskKey("SATA-0-0") || isVirtualBoxDiskKey("SATA-0-0-type") {
		t.Fatalf("unexpected VirtualBox disk key detection")
	}
}

func TestNormalizeVSphereStates(t *testing.T) {
	if normalizeVSpherePowerState("POWERED_ON") != "running" || normalizeVSpherePowerState("POWERED_OFF") != "stopped" {
		t.Fatalf("unexpected vSphere power state normalization")
	}
	if normalizeVSphereHostState("connected", "") != "online" {
		t.Fatalf("unexpected vSphere host state normalization")
	}
}

func TestParseVMwareVMX(t *testing.T) {
	config := parseVMwareVMX(`displayName = "Nested Linux"
uuid.bios = "56 4d 12 34 56 78"
numvcpus = "4"
memsize = "8192"
scsi0:0.fileName = "nested.vmdk"
scsi0:0.deviceType = "scsi-hardDisk"
ethernet0.present = "TRUE"
ethernet0.address = "00:50:56:aa:bb:cc"
ethernet0.connectionType = "bridged"
ethernet0.networkName = "VM Network"
`)
	if config["displayname"] != "Nested Linux" || config["scsi0:0.filename"] != "nested.vmdk" {
		t.Fatalf("unexpected VMware VMX data: %#v", config)
	}
	if !isVMwareDiskPrefix("scsi0:0.filename") || !isVMwareDiskPrefix("ide1:0.filename") {
		t.Fatalf("unexpected VMware disk key detection")
	}
	paths := parseVMwareVMPaths("Total registered VMs: 1\nC:\\VMs\\nested\\nested.vmx")
	if len(paths) != 1 || paths[0] != "C:\\VMs\\nested\\nested.vmx" {
		t.Fatalf("unexpected VMware VM paths: %#v", paths)
	}
}

func TestParseQEMUProcess(t *testing.T) {
	vm := parseQEMUProcess(qemuProcessRecord{
		PID:         42,
		CommandLine: "qemu-system-x86_64 -name guest=nested,debug-threads=on -m 2G,maxmem=4G -smp 4 -drive file=/var/lib/libvirt/images/nested.qcow2,if=virtio -netdev bridge,id=n0,br=vmbr0",
	})
	if vm.Name != "nested" || vm.CPU.ConfiguredCores == nil || *vm.CPU.ConfiguredCores != 4 {
		t.Fatalf("unexpected QEMU process CPU/name: %#v", vm)
	}
	if vm.Memory.ConfiguredBytes == nil || *vm.Memory.ConfiguredBytes != 2*1024*1024*1024 {
		t.Fatalf("unexpected QEMU process memory: %#v", vm.Memory)
	}
	if len(vm.Disks) != 1 || vm.Disks[0].Path != "/var/lib/libvirt/images/nested.qcow2" || len(vm.Networks) != 1 || vm.Networks[0].Bridge != "vmbr0" {
		t.Fatalf("unexpected QEMU process devices: disks=%#v networks=%#v", vm.Disks, vm.Networks)
	}
}
