//go:build linux

package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v4/disk"
)

const (
	// Tiny volumes are not worth a row: 4 MiB EFI/tpm/cloud-init volumes are
	// individual virtual machine parts, which this feature deliberately does
	// not list.
	storagePoolMinimumVolumeBytes = 1 << 30
	storagePoolProbeTimeout       = 3 * time.Second
)

// storagePoolPseudoFilesystems never represent a place virtual machine disks
// live. tmpfs/devtmpfs are memory, the rest are kernel or container plumbing.
var storagePoolPseudoFilesystems = map[string]bool{
	"proc": true, "sysfs": true, "devtmpfs": true, "devpts": true, "tmpfs": true,
	"cgroup": true, "cgroup2": true, "securityfs": true, "pstore": true, "efivarfs": true,
	"bpf": true, "debugfs": true, "tracefs": true, "configfs": true, "fusectl": true,
	"mqueue": true, "hugetlbfs": true, "ramfs": true, "autofs": true, "rpc_pipefs": true,
	"nsfs": true, "overlay": true, "squashfs": true, "selinuxfs": true, "binfmt_misc": true,
	"systemd-1": true, "nfsd": true, "iso9660": true, "udf": true, "devfs": true,
	"fuse": true, "fuse.lxcfs": true, "fuse.gvfsd-fuse": true, "fuse.portal": true,
}

// collectGenericStoragePools builds the OS-level view: mounted filesystems
// (including network shares, which the disk collector filters out), unmounted
// LVM volumes and thin pools, and ZFS pools.
func collectGenericStoragePools() ([]storagePoolStats, error) {
	pools := make([]storagePoolStats, 0, 16)
	mountPools, mountErr := collectStorageMountPools()
	pools = append(pools, mountPools...)
	pools = append(pools, collectLVMStoragePools(mountedDeviceSet(), swapDeviceSet())...)
	pools = append(pools, collectZFSStoragePools()...)
	sortStoragePools(pools)
	return pools, mountErr
}

// collectStorageMountPools lists every mounted real filesystem except the ones
// that are not storage (see storagePoolShouldSkipMount). Capacity comes from
// statfs with the same timeout guard the disk collector uses, because a stale
// network mount can block statfs for minutes.
func collectStorageMountPools() ([]storagePoolStats, error) {
	partitions, err := disk.Partitions(true)
	if err != nil {
		return nil, newCollectorIssueError(logCategoryStorageSlow, err)
	}
	pools := make([]storagePoolStats, 0, len(partitions))
	seenMounts := map[string]struct{}{}
	seenDevices := map[string]struct{}{}
	for _, partition := range partitions {
		mountPoint := strings.TrimSpace(partition.Mountpoint)
		device := strings.TrimSpace(partition.Device)
		fileSystem := strings.ToLower(strings.TrimSpace(partition.Fstype))
		if storagePoolShouldSkipMount(mountPoint, device, fileSystem) {
			continue
		}
		if _, exists := seenMounts[mountPoint]; exists {
			continue
		}
		seenMounts[mountPoint] = struct{}{}
		// A bind mount shares the source device with its origin; only the first
		// (mount-order) entry is the storage entity.
		if _, exists := seenDevices[device]; exists {
			continue
		}
		usage, usageErr := diskUsageWithTimeout(mountPoint, diskUsageTimeout)
		if usageErr != nil {
			if errors.Is(usageErr, errDiskUsageTimeout) {
				logCategoryf(logCategoryStorageSlow, "storage pool usage skipped for %s: %v", mountPoint, usageErr)
			}
			continue
		}
		if usage == nil || usage.Total == 0 {
			continue
		}
		seenDevices[device] = struct{}{}
		available := usage.Free
		pools = append(pools, storagePoolStats{
			ID:              "mount:" + mountPoint,
			Name:            mountPoint,
			Kind:            storagePoolKindForFilesystem(fileSystem),
			Source:          storagePoolSourceMount,
			MountPoint:      mountPoint,
			Device:          device,
			PhysicalDevices: storagePoolPhysicalDevices(device),
			TotalBytes:      usage.Total,
			UsedBytes:       usage.Used,
			AvailableBytes:  &available,
		})
	}
	return pools, nil
}

func storagePoolShouldSkipMount(mountPoint, device, fileSystem string) bool {
	if mountPoint == "" {
		return true
	}
	if storagePoolPseudoFilesystems[fileSystem] {
		return true
	}
	// The OS disk and the boot partition belong to the disk section; listing
	// them again as pools would double-report one partition.
	if mountPoint == "/" || mountPoint == "/boot" || strings.HasPrefix(mountPoint, "/boot/") {
		return true
	}
	if strings.HasPrefix(mountPoint, "/snap") {
		return true
	}
	if strings.HasPrefix(device, "/dev/loop") {
		return true
	}
	if fileSystem == "swap" || mountPoint == "[SWAP]" {
		return true
	}
	// An individual virtual machine disk mounted on the host (for example a
	// Proxmox vm-106-disk-3 partition) is not a pool: the whole pool that
	// contains it is what this feature reports.
	if storagePoolIsVirtualMachineDevice(device) {
		return true
	}
	return false
}

func storagePoolKindForFilesystem(fileSystem string) string {
	switch fileSystem {
	case "nfs", "nfs4":
		return storagePoolKindNFS
	case "cifs", "smb3", "smb":
		return storagePoolKindCIFS
	case "zfs":
		return storagePoolKindZFS
	case "btrfs":
		return storagePoolKindBtrfs
	default:
		return storagePoolKindFilesystem
	}
}

// --- device-mapper / LVM --------------------------------------------------

type storagePoolDMDevice struct {
	Name      string
	UUID      string
	SizeBytes uint64
	Path      string
}

// collectDMDevices enumerates device-mapper devices from sysfs. The names and
// UUIDs are world-readable, which matters because the Linux agent service runs
// as an unprivileged user where lvs/vgs/dmsetup all fail.
func collectDMDevices() []storagePoolDMDevice {
	entries, err := os.ReadDir("/sys/block")
	if err != nil {
		return nil
	}
	devices := make([]storagePoolDMDevice, 0, len(entries))
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasPrefix(name, "dm-") {
			continue
		}
		dmName := readSysfsTrimmed(filepath.Join("/sys/block", name, "dm", "name"))
		if dmName == "" {
			continue
		}
		device := storagePoolDMDevice{
			Name: dmName,
			UUID: readSysfsTrimmed(filepath.Join("/sys/block", name, "dm", "uuid")),
			Path: "/dev/" + name,
		}
		if rawSize := readSysfsTrimmed(filepath.Join("/sys/block", name, "size")); rawSize != "" {
			if sectors, err := strconv.ParseUint(rawSize, 10, 64); err == nil {
				device.SizeBytes = sectors * 512
			}
		}
		devices = append(devices, device)
	}
	return devices
}

func readSysfsTrimmed(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

// classifyStoragePoolDMDevice turns one device-mapper device into an LVM
// volume identity. Thin pool sub-volumes (tpool/tdata/tmeta) are skipped: the
// pool itself is the entity that holds virtual machine disks.
func classifyStoragePoolDMDevice(name, uuid string) (kind string, volumeGroup string, volume string, ok bool) {
	switch {
	case strings.HasSuffix(uuid, "-tpool"), strings.HasSuffix(uuid, "-tdata"), strings.HasSuffix(uuid, "-tmeta"):
		return "", "", "", false
	case strings.HasSuffix(uuid, "-pool"):
		kind = storagePoolKindLVMThin
	default:
		kind = storagePoolKindLVM
	}
	volumeGroup, volume, ok = splitLVMDeviceName(name)
	if !ok {
		return "", "", "", false
	}
	return kind, volumeGroup, volume, true
}

// splitLVMDeviceName splits the escaped "<vg>-<lv>" device name LVM writes to
// /sys/block/dm-*/dm/name. A literal '-' inside either name is written as '--',
// so the separator is the first single '-'.
func splitLVMDeviceName(name string) (string, string, bool) {
	for index := 0; index < len(name); index++ {
		if name[index] != '-' {
			continue
		}
		previousDash := index > 0 && name[index-1] == '-'
		nextDash := index+1 < len(name) && name[index+1] == '-'
		if previousDash || nextDash {
			continue
		}
		volumeGroup := unescapeLVMName(name[:index])
		volume := unescapeLVMName(name[index+1:])
		if volumeGroup == "" || volume == "" {
			return "", "", false
		}
		return volumeGroup, volume, true
	}
	return "", "", false
}

func unescapeLVMName(value string) string {
	return strings.ReplaceAll(value, "--", "-")
}

// isProxmoxVirtualMachineVolume reports whether an LVM volume belongs to one
// virtual machine (vm-<id>-disk-*, vm-<id>-cloudinit, snap_*). Those are the
// individual files the feature must not list.
func isProxmoxVirtualMachineVolume(volume string) bool {
	if strings.HasPrefix(volume, "snap_") {
		return true
	}
	if !strings.HasPrefix(volume, "vm-") {
		return false
	}
	rest := strings.TrimPrefix(volume, "vm-")
	digits := 0
	for digits < len(rest) && rest[digits] >= '0' && rest[digits] <= '9' {
		digits++
	}
	return digits > 0 && digits < len(rest) && rest[digits] == '-'
}

func collectLVMStoragePools(mountedDevices map[string]struct{}, swapDevices map[string]struct{}) []storagePoolStats {
	report := collectLVMReport()
	pools := make([]storagePoolStats, 0, 8)
	for _, device := range collectDMDevices() {
		kind, volumeGroup, volume, ok := classifyStoragePoolDMDevice(device.Name, device.UUID)
		if !ok || isProxmoxVirtualMachineVolume(volume) {
			continue
		}
		mapperPath := "/dev/mapper/" + device.Name
		if _, isSwap := swapDevices[device.Name]; isSwap {
			continue
		}
		if _, isSwap := swapDevices[mapperPath]; isSwap {
			continue
		}
		if _, isMounted := mountedDevices[mapperPath]; isMounted {
			continue
		}
		if _, isMounted := mountedDevices["/dev/"+volumeGroup+"/"+volume]; isMounted {
			continue
		}
		if device.SizeBytes < storagePoolMinimumVolumeBytes {
			continue
		}
		pool := storagePoolStats{
			ID:              "lvm:" + volumeGroup + "/" + volume,
			Name:            volumeGroup + "/" + volume,
			Kind:            kind,
			Source:          storagePoolSourceLVM,
			Device:          mapperPath,
			VolumeGroup:     volumeGroup,
			TotalBytes:      device.SizeBytes,
			PhysicalDevices: storagePoolPhysicalDevices(mapperPath),
		}
		if kind == storagePoolKindLVMThin {
			pool.ThinPool = volume
		}
		// lvs only succeeds for a privileged collector, but then it carries the
		// thin pool allocation percentages that sysfs does not expose.
		if entry, exists := report[volumeGroup+"/"+volume]; exists {
			if entry.SizeBytes > 0 {
				pool.TotalBytes = entry.SizeBytes
			}
			pool.DataPercent = entry.DataPercent
			pool.MetadataPercent = entry.MetadataPercent
		}
		pools = append(pools, pool)
	}
	return pools
}

type storagePoolLVMReportEntry struct {
	SizeBytes       uint64
	DataPercent     *float64
	MetadataPercent *float64
}

// collectLVMReport asks lvs for the volume list when the collector is allowed
// to run it. LVM refuses to run for an unprivileged user (the global lock in
// /run/lock/lvm is root-only), and the Proxmox nodes run the agent that way, so
// the probe is skipped entirely instead of spawning a process that can never
// succeed once per cycle. On a privileged collector it carries the thin pool
// allocation percentages that sysfs does not expose.
func collectLVMReport() map[string]storagePoolLVMReportEntry {
	if os.Geteuid() != 0 {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), storagePoolProbeTimeout)
	defer cancel()
	output, err := probeRunner(ctx, "lvs",
		"--noheadings", "--units", "b", "--nosuffix", "--reportformat", "json",
		"-o", "vg_name,lv_name,lv_size,data_percent,metadata_percent")
	if err != nil {
		return nil
	}
	var envelope struct {
		Report []struct {
			VolumeGroups []struct {
				VolumeGroup     string `json:"vg_name"`
				Volume          string `json:"lv_name"`
				Size            string `json:"lv_size"`
				DataPercent     string `json:"data_percent"`
				MetadataPercent string `json:"metadata_percent"`
			} `json:"lv"`
		} `json:"report"`
	}
	if err := json.Unmarshal(output, &envelope); err != nil {
		return nil
	}
	entries := map[string]storagePoolLVMReportEntry{}
	for _, report := range envelope.Report {
		for _, entry := range report.VolumeGroups {
			key := strings.TrimSpace(entry.VolumeGroup) + "/" + strings.TrimSpace(entry.Volume)
			parsed := storagePoolLVMReportEntry{}
			if size, err := strconv.ParseUint(strings.TrimSpace(entry.Size), 10, 64); err == nil {
				parsed.SizeBytes = size
			}
			parsed.DataPercent = parseStoragePoolPercent(entry.DataPercent)
			parsed.MetadataPercent = parseStoragePoolPercent(entry.MetadataPercent)
			entries[key] = parsed
		}
	}
	return entries
}

func parseStoragePoolPercent(value string) *float64 {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	parsed, err := strconv.ParseFloat(trimmed, 64)
	if err != nil {
		return nil
	}
	return &parsed
}

// --- ZFS ------------------------------------------------------------------

func collectZFSStoragePools() []storagePoolStats {
	// /dev/zfs only exists while the kernel module is loaded; checking it keeps
	// hosts without ZFS from spawning a probe every cycle.
	if _, err := os.Stat("/dev/zfs"); err != nil {
		return nil
	}
	if _, err := execLookPath("zpool"); err != nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), storagePoolProbeTimeout)
	defer cancel()
	output, err := probeRunner(ctx, "zpool", "list", "-Hp", "-o", "name,size,alloc,free,health")
	if err != nil {
		return nil
	}
	pools := make([]storagePoolStats, 0, 4)
	for _, line := range strings.Split(string(output), "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) < 5 {
			continue
		}
		name := fields[0]
		total, totalErr := strconv.ParseUint(fields[1], 10, 64)
		used, usedErr := strconv.ParseUint(fields[2], 10, 64)
		free, freeErr := strconv.ParseUint(fields[3], 10, 64)
		if name == "" || totalErr != nil || usedErr != nil {
			continue
		}
		pool := storagePoolStats{
			ID:         "zfs:" + name,
			Name:       name,
			Kind:       storagePoolKindZFS,
			Source:     storagePoolSourceZFS,
			TotalBytes: total,
			UsedBytes:  used,
			Health:     strings.ToLower(strings.TrimSpace(fields[4])),
		}
		if freeErr == nil {
			available := free
			pool.AvailableBytes = &available
		}
		pools = append(pools, pool)
	}
	return pools
}

// --- shared OS helpers ----------------------------------------------------

// mountedDeviceSet collects every mounted source device so an unmounted-volume
// scan does not report a mounted filesystem twice.
func mountedDeviceSet() map[string]struct{} {
	devices := map[string]struct{}{}
	data, err := os.ReadFile("/proc/self/mountinfo")
	if err != nil {
		return devices
	}
	for _, line := range strings.Split(string(data), "\n") {
		separator := strings.Index(line, " - ")
		if separator < 0 {
			continue
		}
		fields := strings.Fields(line[separator+3:])
		if len(fields) < 2 {
			continue
		}
		device := strings.TrimSpace(fields[1])
		if !strings.HasPrefix(device, "/dev/") {
			continue
		}
		devices[device] = struct{}{}
		if resolved, resolveErr := filepath.EvalSymlinks(device); resolveErr == nil {
			devices[resolved] = struct{}{}
		}
	}
	return devices
}

// swapDeviceSet keeps swap volumes out of the pool list: a swap LV is host
// memory plumbing, not virtual machine storage.
func swapDeviceSet() map[string]struct{} {
	devices := map[string]struct{}{}
	data, err := os.ReadFile("/proc/swaps")
	if err != nil {
		return devices
	}
	for index, line := range strings.Split(string(data), "\n") {
		if index == 0 {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		devices[fields[0]] = struct{}{}
		if dmName := storagePoolDMNameForPath(fields[0]); dmName != "" {
			devices[dmName] = struct{}{}
		}
	}
	return devices
}

// storagePoolDMNameForPath resolves a device path to the device-mapper name
// (for example /dev/mapper/pve-data -> pve-data) when it is a dm device.
func storagePoolDMNameForPath(path string) string {
	base := storagePoolSysfsBlockBase(path)
	if !strings.HasPrefix(base, "dm-") {
		return ""
	}
	return readSysfsTrimmed(filepath.Join("/sys/block", base, "dm", "name"))
}

func storagePoolSysfsBlockBase(device string) string {
	path := strings.TrimSpace(device)
	if path == "" {
		return ""
	}
	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		path = resolved
	}
	return filepath.Base(path)
}

// storagePoolPhysicalDevices walks the sysfs slave chain down to the physical
// disks a pool is built on (thin pool -> tpool -> tdata -> nvme0n1p3 ->
// nvme0n1), so the console can show which disk holds the virtual machines.
// Non-block sources (an NFS export string, a UUID) have no physical device.
func storagePoolPhysicalDevices(device string) []string {
	if !strings.HasPrefix(strings.TrimSpace(device), "/dev/") {
		return nil
	}
	base := storagePoolSysfsBlockBase(device)
	if base == "" {
		return nil
	}
	seen := map[string]struct{}{}
	var walk func(name string, depth int)
	walk = func(name string, depth int) {
		if depth > 4 {
			return
		}
		slaves, err := os.ReadDir(filepath.Join("/sys/block", name, "slaves"))
		if err != nil || len(slaves) == 0 {
			physical := linuxBlockDeviceName(name)
			if physical != "" {
				seen[physical] = struct{}{}
			}
			return
		}
		for _, slave := range slaves {
			walk(slave.Name(), depth+1)
		}
	}
	walk(base, 0)
	result := make([]string, 0, len(seen))
	for name := range seen {
		result = append(result, name)
	}
	sort.Strings(result)
	return result
}

// storagePoolIsVirtualMachineDevice reports whether a mounted device is a
// Proxmox per-virtual-machine volume. The sysfs device-mapper name is checked
// first because /dev/mapper/<name> is the canonical form; the raw basename
// covers partitions such as pve-vm--106--disk--3p1.
func storagePoolIsVirtualMachineDevice(device string) bool {
	trimmed := strings.TrimSpace(device)
	if trimmed == "" {
		return false
	}
	if dmName := storagePoolDMNameForPath(trimmed); dmName != "" {
		if _, _, volume, ok := classifyStoragePoolDMDevice(dmName, ""); ok {
			return isProxmoxVirtualMachineVolume(volume)
		}
	}
	return strings.Contains(filepath.Base(trimmed), "-vm--")
}

// execLookPath is a variable so a test can simulate a host without the probe
// binary without touching the real PATH.
var execLookPath = exec.LookPath
