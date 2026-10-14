//go:build linux

package main

import "testing"

func TestSplitLVMDeviceName(t *testing.T) {
	cases := []struct {
		input string
		vg    string
		lv    string
		ok    bool
	}{
		{input: "pve-root", vg: "pve", lv: "root", ok: true},
		{input: "pve-data", vg: "pve", lv: "data", ok: true},
		{input: "pve-vm--106--disk--3", vg: "pve", lv: "vm-106-disk-3", ok: true},
		{input: "pve3_hdd_vg-hdd_data", vg: "pve3_hdd_vg", lv: "hdd_data", ok: true},
		{input: "my--vg-lv", vg: "my-vg", lv: "lv", ok: true},
		{input: "vg--name-lv--name", vg: "vg-name", lv: "lv-name", ok: true},
		{input: "no-separator-here-", vg: "no", lv: "separator-here-", ok: true},
		{input: "nodash", ok: false},
		{input: "-leading", ok: false},
		{input: "trailing-", ok: false},
	}
	for _, testCase := range cases {
		vg, lv, ok := splitLVMDeviceName(testCase.input)
		if ok != testCase.ok || vg != testCase.vg || lv != testCase.lv {
			t.Fatalf("splitLVMDeviceName(%q) = (%q, %q, %v), want (%q, %q, %v)",
				testCase.input, vg, lv, ok, testCase.vg, testCase.lv, testCase.ok)
		}
	}
}

func TestClassifyStoragePoolDMDevice(t *testing.T) {
	cases := []struct {
		name      string
		uuid      string
		kind      string
		volume    string
		volumeGrp string
		ok        bool
	}{
		{
			name: "pve-data", uuid: "LVM-abc-pool",
			kind: storagePoolKindLVMThin, volumeGrp: "pve", volume: "data", ok: true,
		},
		{
			name: "pve-data-tpool", uuid: "LVM-abc-tpool",
			ok: false,
		},
		{
			name: "pve-data_tdata", uuid: "LVM-abc-tdata",
			ok: false,
		},
		{
			name: "pve-data_tmeta", uuid: "LVM-abc-tmeta",
			ok: false,
		},
		{
			name: "pve-root", uuid: "LVM-abc",
			kind: storagePoolKindLVM, volumeGrp: "pve", volume: "root", ok: true,
		},
	}
	for _, testCase := range cases {
		kind, volumeGroup, volume, ok := classifyStoragePoolDMDevice(testCase.name, testCase.uuid)
		if ok != testCase.ok || kind != testCase.kind || volumeGroup != testCase.volumeGrp || volume != testCase.volume {
			t.Fatalf("classify(%q, %q) = (%q, %q, %q, %v), want (%q, %q, %q, %v)",
				testCase.name, testCase.uuid, kind, volumeGroup, volume, ok,
				testCase.kind, testCase.volumeGrp, testCase.volume, testCase.ok)
		}
	}
}

func TestIsProxmoxVirtualMachineVolume(t *testing.T) {
	for _, volume := range []string{"vm-100-disk-1", "vm-106-disk-3p1", "vm-121-cloudinit", "snap_vm-112-disk-0_pre-40hx"} {
		if !isProxmoxVirtualMachineVolume(volume) {
			t.Fatalf("isProxmoxVirtualMachineVolume(%q) = false", volume)
		}
	}
	for _, volume := range []string{"data", "root", "swap", "archive-2026", "vmdata"} {
		if isProxmoxVirtualMachineVolume(volume) {
			t.Fatalf("isProxmoxVirtualMachineVolume(%q) = true", volume)
		}
	}
}

func TestStoragePoolShouldSkipMount(t *testing.T) {
	cases := []struct {
		mountPoint string
		device     string
		fileSystem string
		skip       bool
	}{
		{mountPoint: "/mnt/pve/NAS-VM", device: "192.168.5.17:/fs/1000/nfs/PVE", fileSystem: "nfs4", skip: false},
		{mountPoint: "/mnt/archive", device: "/dev/sdb1", fileSystem: "ext4", skip: false},
		{mountPoint: "/", device: "/dev/mapper/pve-root", fileSystem: "ext4", skip: true},
		{mountPoint: "/boot/efi", device: "/dev/nvme0n1p2", fileSystem: "vfat", skip: true},
		{mountPoint: "/etc/pve", device: "/dev/fuse", fileSystem: "fuse", skip: true},
		{mountPoint: "/var/lib/lxcfs", device: "lxcfs", fileSystem: "fuse.lxcfs", skip: true},
		{mountPoint: "/dev/shm", device: "tmpfs", fileSystem: "tmpfs", skip: true},
		{mountPoint: "[SWAP]", device: "/dev/mapper/pve-swap", fileSystem: "swap", skip: true},
		{mountPoint: "/mnt/vm106oc", device: "/dev/mapper/pve-vm--106--disk--3p1", fileSystem: "vfat", skip: true},
		{mountPoint: "/snap/core/1", device: "/dev/loop3", fileSystem: "squashfs", skip: true},
	}
	for _, testCase := range cases {
		skip := storagePoolShouldSkipMount(testCase.mountPoint, testCase.device, testCase.fileSystem)
		if skip != testCase.skip {
			t.Fatalf("storagePoolShouldSkipMount(%q, %q, %q) = %v, want %v",
				testCase.mountPoint, testCase.device, testCase.fileSystem, skip, testCase.skip)
		}
	}
}

func TestStoragePoolKindForFilesystem(t *testing.T) {
	cases := map[string]string{
		"nfs":   storagePoolKindNFS,
		"nfs4":  storagePoolKindNFS,
		"cifs":  storagePoolKindCIFS,
		"smb3":  storagePoolKindCIFS,
		"zfs":   storagePoolKindZFS,
		"btrfs": storagePoolKindBtrfs,
		"ext4":  storagePoolKindFilesystem,
		"xfs":   storagePoolKindFilesystem,
		"vfat":  storagePoolKindFilesystem,
		"":      storagePoolKindFilesystem,
	}
	for input, expected := range cases {
		if actual := storagePoolKindForFilesystem(input); actual != expected {
			t.Fatalf("storagePoolKindForFilesystem(%q) = %q, want %q", input, actual, expected)
		}
	}
}

func TestStoragePoolIsVirtualMachineDevice(t *testing.T) {
	for _, device := range []string{"/dev/mapper/pve-vm--106--disk--3p1", "/dev/mapper/pve-vm--100--disk--1"} {
		if !storagePoolIsVirtualMachineDevice(device) {
			t.Fatalf("storagePoolIsVirtualMachineDevice(%q) = false", device)
		}
	}
	for _, device := range []string{"/dev/mapper/pve-root", "/dev/sda1", "192.168.5.17:/fs/1000/nfs/PVE", ""} {
		if storagePoolIsVirtualMachineDevice(device) {
			t.Fatalf("storagePoolIsVirtualMachineDevice(%q) = true", device)
		}
	}
}
