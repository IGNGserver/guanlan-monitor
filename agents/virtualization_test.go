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
