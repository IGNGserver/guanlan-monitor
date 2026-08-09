package main

import (
	"context"
	"fmt"
	"runtime"
	"strconv"
	"strings"
)

type virtualBoxVMRecord struct {
	ID       string
	Name     string
	State    string
	CPUs     int
	MemoryMB uint64
	Disks    []virtualizationDiskDevice
	Networks []virtualizationNetworkDevice
	Guest    *virtualizationGuestInfo
}

func collectVirtualBoxSnapshot(ctx context.Context, cfg agentVirtualizationConfig) (*virtualizationSnapshot, error) {
	vboxManage := firstNonEmptyEnv("DSC_VIRTUALIZATION_VBOXMANAGE")
	if vboxManage == "" {
		vboxManage = "VBoxManage"
	}
	listOutput, err := runVirtualizationCommand(ctx, vboxManage, "list", "vms")
	if err != nil {
		return nil, fmt.Errorf("virtualbox VM list: %w", err)
	}
	now := timeNowUTC()
	snapshot := &virtualizationSnapshot{
		Platform:     "virtualbox",
		Source:       vboxManage,
		CollectedAt:  now,
		Nodes:        []virtualizationNodeTelemetry{},
		VMs:          []virtualMachineTelemetry{},
		Capabilities: []string{"vm_inventory", "vm_cpu", "vm_memory", "vm_disk", "vm_network", "virtualbox_guest_properties"},
		Issues:       []virtualizationIssue{},
	}
	snapshot.Nodes = append(snapshot.Nodes, virtualizationNodeTelemetry{
		ID:       firstNonEmpty(runtime.GOOS, "virtualbox-host"),
		Name:     firstNonEmpty(runtime.GOOS, "virtualbox-host"),
		Platform: "virtualbox",
		Status:   "online",
		CPU: &virtualizationCPUStats{
			ConfiguredCores: intPointer(runtime.NumCPU()),
		},
	})
	for _, entry := range parseVirtualBoxVMList(listOutput) {
		vm, vmErr := collectVirtualBoxVM(ctx, vboxManage, entry.id, entry.name)
		if vmErr != nil {
			snapshot.Issues = append(snapshot.Issues, virtualizationIssue{Code: "vm_refresh_failed", Message: vmErr.Error(), Scope: entry.id, Retryable: true})
			continue
		}
		snapshot.VMs = append(snapshot.VMs, vm)
	}
	return snapshot, nil
}

type virtualBoxListEntry struct {
	name string
	id   string
}

func parseVirtualBoxVMList(output string) []virtualBoxListEntry {
	result := []virtualBoxListEntry{}
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		nameEnd := strings.LastIndex(line, "\"")
		if !strings.HasPrefix(line, "\"") || nameEnd <= 0 {
			continue
		}
		name := strings.ReplaceAll(line[1:nameEnd], "\\\"", "\"")
		openBrace := strings.LastIndex(line, "{")
		closeBrace := strings.LastIndex(line, "}")
		if openBrace < 0 || closeBrace <= openBrace {
			continue
		}
		id := strings.TrimSpace(line[openBrace+1 : closeBrace])
		if id != "" {
			result = append(result, virtualBoxListEntry{name: name, id: id})
		}
	}
	return result
}

func collectVirtualBoxVM(ctx context.Context, vboxManage, id, fallbackName string) (virtualMachineTelemetry, error) {
	output, err := runVirtualizationCommand(ctx, vboxManage, "showvminfo", id, "--machinereadable")
	if err != nil {
		return virtualMachineTelemetry{}, err
	}
	fields := parseVirtualBoxMachineReadable(output)
	name := strings.Trim(fields["name"], "\"")
	if name == "" {
		name = fallbackName
	}
	vm := virtualMachineTelemetry{
		ID:         firstNonEmpty(strings.Trim(fields["UUID"], "\""), id),
		Name:       name,
		Platform:   "virtualbox",
		Type:       "vm",
		PowerState: normalizeVirtualBoxPowerState(strings.Trim(fields["VMState"], "\"")),
		CPU: &virtualizationCPUStats{
			ConfiguredCores: intPointer(parseIntField(fields["cpus"])),
		},
		Memory: &virtualizationMemoryStats{
			ConfiguredBytes: uintPointer(parseUintField(fields["memory"]) * 1024 * 1024),
		},
		Disks:    []virtualizationDiskDevice{},
		Networks: []virtualizationNetworkDevice{},
	}
	for key, value := range fields {
		if !isVirtualBoxDiskKey(key) || strings.EqualFold(strings.Trim(value, "\""), "none") {
			continue
		}
		path := strings.Trim(value, "\"")
		disk := virtualizationDiskDevice{
			ID:      key,
			Name:    key,
			Storage: "virtualbox",
			Path:    path,
		}
		if infoOutput, infoErr := runVirtualizationCommand(ctx, vboxManage, "showmediuminfo", path); infoErr == nil {
			disk.CapacityBytes, disk.AllocatedBytes = parseVirtualBoxMediumInfo(infoOutput)
		}
		vm.Disks = append(vm.Disks, disk)
	}
	for index := 1; index <= 8; index++ {
		nicKey := fmt.Sprintf("nic%d", index)
		attachType := strings.Trim(fields[nicKey], "\"")
		if attachType == "" || strings.EqualFold(attachType, "none") {
			continue
		}
		vm.Networks = append(vm.Networks, virtualizationNetworkDevice{
			ID:         nicKey,
			Name:       nicKey,
			Network:    attachType,
			SwitchName: strings.Trim(fields[fmt.Sprintf("bridgeadapter%d", index)], "\""),
			MACAddress: normalizeMACAddress(strings.Trim(fields[fmt.Sprintf("macaddress%d", index)], "\"")),
		})
	}
	vm.Guest = collectVirtualBoxGuestInfo(ctx, vboxManage, id)
	return vm, nil
}

func parseVirtualBoxMachineReadable(output string) map[string]string {
	result := map[string]string{}
	for _, line := range strings.Split(output, "\n") {
		separator := strings.Index(line, "=")
		if separator <= 0 {
			continue
		}
		key := strings.TrimSpace(line[:separator])
		value := strings.TrimSpace(line[separator+1:])
		if key != "" {
			result[key] = value
		}
	}
	return result
}

func isVirtualBoxDiskKey(key string) bool {
	parts := strings.Split(key, "-")
	if len(parts) != 3 || !containsVirtualBoxController(parts[0]) {
		return false
	}
	for _, part := range parts[1:] {
		if _, err := strconv.Atoi(part); err != nil {
			return false
		}
	}
	return true
}

func containsVirtualBoxController(value string) bool {
	switch strings.ToUpper(value) {
	case "IDE", "SATA", "SCSI", "SAS", "NVME", "VIRTIO-SCSI":
		return true
	default:
		return false
	}
}

func parseVirtualBoxMediumInfo(output string) (*uint64, *uint64) {
	var capacity, allocated uint64
	for _, line := range strings.Split(output, "\n") {
		separator := strings.Index(line, ":")
		if separator <= 0 {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(line[:separator]))
		value := strings.TrimSpace(line[separator+1:])
		switch key {
		case "logical size", "capacity":
			capacity = parseLibvirtBytes(value)
		case "size on disk":
			allocated = parseLibvirtBytes(value)
		}
	}
	return uintPointer(capacity), uintPointer(allocated)
}

func collectVirtualBoxGuestInfo(ctx context.Context, vboxManage, id string) *virtualizationGuestInfo {
	guest := &virtualizationGuestInfo{AgentAvailable: false, Source: "virtualbox-guest-properties"}
	output, err := runVirtualizationCommand(ctx, vboxManage, "guestproperty", "enumerate", id)
	if err != nil {
		return guest
	}
	for _, line := range strings.Split(output, "\n") {
		separator := strings.Index(line, ", value:")
		if separator <= 0 {
			continue
		}
		key := strings.TrimSpace(strings.TrimPrefix(line[:separator], "Name: "))
		value := strings.TrimSpace(strings.SplitN(line[separator+len(", value:"):], ",", 2)[0])
		switch {
		case strings.HasSuffix(key, "/Net/0/V4/IP"):
			guest.IPv4 = append(guest.IPv4, value)
		case strings.HasSuffix(key, "/Net/0/V6/IP"):
			guest.IPv6 = append(guest.IPv6, value)
		case strings.HasSuffix(key, "/OS/Product"):
			guest.Hostname = value
		}
	}
	guest.AgentAvailable = len(guest.IPv4) > 0 || len(guest.IPv6) > 0 || guest.Hostname != ""
	return guest
}

func normalizeVirtualBoxPowerState(state string) string {
	switch strings.ToLower(strings.TrimSpace(state)) {
	case "running", "paused", "stuck", "restoring":
		return strings.ToLower(strings.TrimSpace(state))
	case "poweroff", "saved", "aborted":
		return "stopped"
	default:
		return firstNonEmpty(state, "unknown")
	}
}
