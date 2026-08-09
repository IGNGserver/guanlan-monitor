package main

import (
	"context"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

func collectVMwareSnapshot(ctx context.Context, cfg agentVirtualizationConfig, platform string) (*virtualizationSnapshot, error) {
	vmrun := firstNonEmptyEnv("DSC_VIRTUALIZATION_VMRUN", "DSC_VMRUN")
	if vmrun == "" {
		vmrun = "vmrun"
	}
	runningOutput, runningErr := runVirtualizationCommand(ctx, vmrun, "list")
	runningPaths := map[string]bool{}
	if runningErr == nil {
		for _, path := range parseVMwareVMPaths(runningOutput) {
			runningPaths[normalizeVMwarePath(path)] = true
		}
	}
	registeredPaths := []string{}
	if registeredOutput, registeredErr := runVirtualizationCommand(ctx, vmrun, "listRegisteredVM"); registeredErr == nil {
		registeredPaths = parseVMwareVMPaths(registeredOutput)
	}
	if len(registeredPaths) == 0 {
		registeredPaths = parseVMwarePathList(firstNonEmptyEnv("DSC_VIRTUALIZATION_VM_PATHS", "DSC_VMWARE_VM_PATHS"))
	}
	for path := range runningPaths {
		if !containsVMwarePath(registeredPaths, path) {
			registeredPaths = append(registeredPaths, path)
		}
	}
	if len(registeredPaths) == 0 && runningErr != nil {
		return nil, fmt.Errorf("VMware vmrun inventory: %w", runningErr)
	}

	snapshot := &virtualizationSnapshot{
		Platform:     platform,
		Source:       vmrun,
		CollectedAt:  timeNowUTC(),
		Nodes:        []virtualizationNodeTelemetry{},
		VMs:          []virtualMachineTelemetry{},
		Capabilities: []string{"vmrun_inventory", "vmx_config", "vm_cpu", "vm_memory", "vm_disk", "vm_network"},
		Issues:       []virtualizationIssue{},
	}
	snapshot.Nodes = append(snapshot.Nodes, virtualizationNodeTelemetry{
		ID:       firstNonEmpty(runtime.GOOS, "vmware-host"),
		Name:     firstNonEmpty(runtime.GOOS, "vmware-host"),
		Platform: platform,
		Status:   "online",
		CPU: &virtualizationCPUStats{
			ConfiguredCores: intPointer(runtime.NumCPU()),
		},
	})
	if len(registeredPaths) == 0 {
		snapshot.Issues = append(snapshot.Issues, virtualizationIssue{Code: "vm_inventory_requires_paths", Message: "vmrun did not expose registered VMs; configure DSC_VIRTUALIZATION_VM_PATHS", Retryable: false})
	}
	for _, vmxPath := range registeredPaths {
		vm, vmErr := collectVMwareVM(ctx, vmrun, vmxPath, platform, runningPaths[normalizeVMwarePath(vmxPath)])
		if vmErr != nil {
			snapshot.Issues = append(snapshot.Issues, virtualizationIssue{Code: "vm_refresh_failed", Message: vmErr.Error(), Scope: vmxPath, Retryable: true})
			continue
		}
		snapshot.VMs = append(snapshot.VMs, vm)
	}
	return snapshot, nil
}

func collectVMwareVM(ctx context.Context, vmrun, vmxPath, platform string, running bool) (virtualMachineTelemetry, error) {
	config, err := readVMwareVMX(vmxPath)
	if err != nil {
		return virtualMachineTelemetry{}, err
	}
	vm := virtualMachineTelemetry{
		ID:         firstNonEmpty(config["uuid.bios"], vmxPath),
		Name:       firstNonEmpty(config["displayname"], filepath.Base(filepath.Dir(vmxPath))),
		Platform:   platform,
		Type:       "vmx",
		PowerState: "stopped",
		CPU: &virtualizationCPUStats{
			ConfiguredCores: intPointer(parseIntField(config["numvcpus"])),
		},
		Memory: &virtualizationMemoryStats{
			ConfiguredBytes: uintPointer(parseUintField(config["memsize"]) * 1024 * 1024),
		},
		Disks:    []virtualizationDiskDevice{},
		Networks: []virtualizationNetworkDevice{},
	}
	if running {
		vm.PowerState = "running"
	}
	for key, value := range config {
		if !strings.HasSuffix(key, ".filename") || !isVMwareDiskPrefix(key) {
			continue
		}
		prefix := strings.TrimSuffix(key, ".filename")
		if strings.EqualFold(config[prefix+".devicetype"], "cdrom") {
			continue
		}
		path := value
		if !filepath.IsAbs(path) {
			path = filepath.Join(filepath.Dir(vmxPath), path)
		}
		disk := virtualizationDiskDevice{ID: prefix, Name: prefix, Storage: "vmware", Path: filepath.Clean(path)}
		if info, infoErr := collectQEMUImageInfo(ctx, disk.Path); infoErr == nil {
			disk.CapacityBytes = uintPointer(info.VirtualSize)
			disk.AllocatedBytes = uintPointer(info.ActualSize)
		}
		vm.Disks = append(vm.Disks, disk)
	}
	for index := 0; index < 16; index++ {
		prefix := fmt.Sprintf("ethernet%d", index)
		if config[prefix+".present"] == "false" {
			continue
		}
		mac := firstNonEmpty(config[prefix+".address"], config[prefix+".generatedaddress"])
		connection := firstNonEmpty(config[prefix+".connectiontype"], config[prefix+".virtualdev"])
		if mac == "" && connection == "" {
			continue
		}
		vm.Networks = append(vm.Networks, virtualizationNetworkDevice{
			ID:         prefix,
			Name:       prefix,
			MACAddress: normalizeMACAddress(mac),
			Network:    connection,
			SwitchName: firstNonEmpty(config[prefix+".networkname"], config[prefix+".vnet"]),
		})
	}
	if running {
		guest := &virtualizationGuestInfo{AgentAvailable: false, Source: "vmrun"}
		if output, guestErr := runVirtualizationCommand(ctx, vmrun, "getGuestIPAddress", vmxPath, "-wait"); guestErr == nil {
			for _, line := range strings.Split(output, "\n") {
				ipText := strings.TrimSpace(line)
				if parsed := net.ParseIP(ipText); parsed != nil {
					if parsed.To4() != nil {
						guest.IPv4 = append(guest.IPv4, ipText)
					} else {
						guest.IPv6 = append(guest.IPv6, ipText)
					}
				}
			}
			guest.AgentAvailable = len(guest.IPv4) > 0 || len(guest.IPv6) > 0
		}
		vm.Guest = guest
	}
	return vm, nil
}

func readVMwareVMX(path string) (map[string]string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read VMware VMX %s: %w", path, err)
	}
	return parseVMwareVMX(string(data)), nil
}

func parseVMwareVMX(output string) map[string]string {
	result := map[string]string{}
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		separator := strings.Index(line, "=")
		if separator <= 0 {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(line[:separator]))
		value := strings.TrimSpace(line[separator+1:])
		value = strings.Trim(value, "\"")
		value = strings.ReplaceAll(value, "\\\"", "\"")
		result[key] = value
	}
	return result
}

func parseVMwareVMPaths(output string) []string {
	result := []string{}
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		lowerLine := strings.ToLower(line)
		if line == "" || strings.HasPrefix(lowerLine, "total running vms") || strings.HasPrefix(lowerLine, "total registered vms") {
			continue
		}
		result = append(result, strings.Trim(line, "\""))
	}
	return result
}

func parseVMwarePathList(value string) []string {
	result := []string{}
	for _, path := range strings.Split(value, ";") {
		if value := strings.TrimSpace(path); value != "" {
			result = append(result, value)
		}
	}
	return result
}

func isVMwareDiskPrefix(key string) bool {
	prefix := strings.TrimSuffix(key, ".filename")
	for _, controller := range []string{"scsi", "sata", "ide", "nvme"} {
		if strings.HasPrefix(prefix, controller) {
			return true
		}
	}
	return false
}

func normalizeVMwarePath(path string) string {
	path = filepath.Clean(strings.TrimSpace(path))
	if runtime.GOOS == "windows" {
		return strings.ToLower(path)
	}
	return path
}

func containsVMwarePath(paths []string, target string) bool {
	target = normalizeVMwarePath(target)
	for _, path := range paths {
		if normalizeVMwarePath(path) == target {
			return true
		}
	}
	return false
}
