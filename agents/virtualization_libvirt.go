package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

type libvirtDomainStats struct {
	Values map[string]uint64
}

func collectLibvirtSnapshot(ctx context.Context, cfg agentVirtualizationConfig, platform string) (*virtualizationSnapshot, error) {
	virsh := firstNonEmptyEnv("DSC_VIRTUALIZATION_VIRSH")
	if virsh == "" {
		virsh = "virsh"
	}
	uri := strings.TrimSpace(cfg.Endpoint)
	if uri == "" {
		uri = firstNonEmptyEnv("DSC_VIRTUALIZATION_LIBVIRT_URI", "DSC_LIBVIRT_URI")
	}
	if uri == "" {
		uri = "qemu:///system"
	}

	baseArgs := []string{"-c", uri}
	nodeInfo, err := runVirtualizationCommand(ctx, virsh, append(baseArgs, "nodeinfo")...)
	if err != nil {
		return nil, fmt.Errorf("libvirt nodeinfo: %w", err)
	}

	now := timeNowUTC()
	snapshot := &virtualizationSnapshot{
		Platform:     platform,
		Source:       uri,
		CollectedAt:  now,
		Nodes:        []virtualizationNodeTelemetry{},
		VMs:          []virtualMachineTelemetry{},
		Storages:     []virtualizationStorage{},
		Capabilities: []string{"node_info", "vm_inventory", "vm_cpu", "vm_memory", "vm_disk", "vm_network", "libvirt_guest_agent"},
		Issues:       []virtualizationIssue{},
	}

	node := parseLibvirtNodeInfo(nodeInfo, platform)
	if cpuStats, cpuErr := collectLibvirtNodeCPUStats(ctx, virsh, baseArgs); cpuErr == nil {
		node.CPU.UsagePercent = floatPointer(cpuStats)
	} else {
		snapshot.Issues = append(snapshot.Issues, virtualizationIssue{Code: "node_cpu_refresh_failed", Message: cpuErr.Error(), Scope: node.ID, Retryable: true})
	}
	storages, storageErr := collectLibvirtStorages(ctx, virsh, baseArgs)
	if storageErr == nil {
		node.Storages = storages
		snapshot.Storages = append(snapshot.Storages, storages...)
		var total, used uint64
		for _, storage := range storages {
			if storage.TotalBytes != nil {
				total += *storage.TotalBytes
			}
			if storage.UsedBytes != nil {
				used += *storage.UsedBytes
			}
		}
		if total > 0 {
			node.Disk = &virtualizationDiskStats{ProvisionedBytes: uintPointer(total), UsedBytes: uintPointer(used)}
		}
	} else {
		snapshot.Issues = append(snapshot.Issues, virtualizationIssue{Code: "storage_refresh_failed", Message: storageErr.Error(), Scope: node.ID, Retryable: true})
	}
	snapshot.Nodes = append(snapshot.Nodes, node)

	domains, err := listLibvirtDomains(ctx, virsh, baseArgs)
	if err != nil {
		return nil, fmt.Errorf("libvirt domain list: %w", err)
	}
	for _, domainName := range domains {
		vm, vmErr := collectLibvirtDomain(ctx, virsh, baseArgs, domainName, platform)
		if vmErr != nil {
			snapshot.Issues = append(snapshot.Issues, virtualizationIssue{Code: "vm_refresh_failed", Message: vmErr.Error(), Scope: domainName, Retryable: true})
			continue
		}
		snapshot.VMs = append(snapshot.VMs, vm)
	}
	return snapshot, nil
}

func timeNowUTC() string {
	return time.Now().UTC().Format(time.RFC3339)
}

func parseLibvirtNodeInfo(output, platform string) virtualizationNodeTelemetry {
	fields := parseColonFields(output)
	cores := parseIntField(fields["CPU(s)"])
	memoryKiB := parseUintField(fields["Memory size"])
	node := virtualizationNodeTelemetry{
		ID:       "libvirt-node",
		Name:     firstNonEmpty(fields["CPU model"], "libvirt-node"),
		Platform: platform,
		Status:   "online",
		CPU: &virtualizationCPUStats{
			ConfiguredCores: intPointer(cores),
		},
		Memory: &virtualizationMemoryStats{
			ConfiguredBytes: uintPointer(memoryKiB * 1024),
		},
	}
	if node.Name == "" {
		node.Name = "libvirt-node"
	}
	return node
}

func collectLibvirtNodeCPUStats(ctx context.Context, virsh string, baseArgs []string) (float64, error) {
	args := append(append([]string{}, baseArgs...), "nodecpustats", "--percent")
	output, err := runVirtualizationCommand(ctx, virsh, args...)
	if err != nil {
		return 0, err
	}
	fields := parseColonFields(output)
	idle := parseFloatField(fields["idle"])
	user := parseFloatField(fields["user"])
	system := parseFloatField(fields["system"])
	iowait := parseFloatField(fields["iowait"])
	busy := user + system + iowait
	if idle == 0 && busy == 0 {
		return 0, fmt.Errorf("libvirt node CPU stats are empty")
	}
	total := idle + busy
	if total <= 0 {
		return 0, fmt.Errorf("libvirt node CPU stats have no total")
	}
	return round((busy / total) * 100), nil
}

func collectLibvirtStorages(ctx context.Context, virsh string, baseArgs []string) ([]virtualizationStorage, error) {
	args := append(append([]string{}, baseArgs...), "pool-list", "--all", "--name")
	output, err := runVirtualizationCommand(ctx, virsh, args...)
	if err != nil {
		return nil, err
	}
	names := parseNonEmptyLines(output)
	result := make([]virtualizationStorage, 0, len(names))
	for _, name := range names {
		infoArgs := append(append([]string{}, baseArgs...), "pool-info", name)
		info, infoErr := runVirtualizationCommand(ctx, virsh, infoArgs...)
		if infoErr != nil {
			return nil, fmt.Errorf("pool %s: %w", name, infoErr)
		}
		fields := parseColonFields(info)
		state := strings.ToLower(fields["State"])
		active := !strings.Contains(state, "inactive") && state != ""
		result = append(result, virtualizationStorage{
			ID:             name,
			Name:           name,
			Type:           "libvirt-pool",
			Active:         boolPointer(active),
			TotalBytes:     uintPointer(parseLibvirtBytes(fields["Capacity"])),
			UsedBytes:      uintPointer(parseLibvirtBytes(fields["Allocation"])),
			AvailableBytes: uintPointer(parseLibvirtBytes(fields["Available"])),
		})
	}
	return result, nil
}

func listLibvirtDomains(ctx context.Context, virsh string, baseArgs []string) ([]string, error) {
	args := append(append([]string{}, baseArgs...), "list", "--all", "--name")
	output, err := runVirtualizationCommand(ctx, virsh, args...)
	if err != nil {
		return nil, err
	}
	return parseNonEmptyLines(output), nil
}

func collectLibvirtDomain(ctx context.Context, virsh string, baseArgs []string, name, platform string) (virtualMachineTelemetry, error) {
	infoArgs := append(append([]string{}, baseArgs...), "dominfo", name)
	infoOutput, err := runVirtualizationCommand(ctx, virsh, infoArgs...)
	if err != nil {
		return virtualMachineTelemetry{}, err
	}
	fields := parseColonFields(infoOutput)
	vm := virtualMachineTelemetry{
		ID:         firstNonEmpty(fields["UUID"], name),
		Name:       firstNonEmpty(fields["Name"], name),
		Platform:   platform,
		Type:       "domain",
		PowerState: normalizeLibvirtPowerState(fields["State"]),
		CPU: &virtualizationCPUStats{
			ConfiguredCores: intPointer(parseIntField(fields["CPU(s)"])),
		},
		Memory: &virtualizationMemoryStats{
			ConfiguredBytes: uintPointer(parseLibvirtBytes(fields["Max memory"])),
			UsedBytes:       uintPointer(parseLibvirtBytes(fields["Used memory"])),
		},
		Disks:    []virtualizationDiskDevice{},
		Networks: []virtualizationNetworkDevice{},
	}
	stats, statsErr := collectLibvirtDomainStats(ctx, virsh, baseArgs, name)
	if statsErr == nil {
		applyLibvirtDomainStats(&vm, stats)
	}
	blockArgs := append(append([]string{}, baseArgs...), "domblklist", name, "--details")
	if blockOutput, blockErr := runVirtualizationCommand(ctx, virsh, blockArgs...); blockErr == nil {
		vm.Disks = parseLibvirtBlockList(blockOutput)
	} else {
		return virtualMachineTelemetry{}, blockErr
	}
	for index := range vm.Disks {
		if vm.Disks[index].Path == "" {
			continue
		}
		if info, infoErr := collectQEMUImageInfo(ctx, vm.Disks[index].Path); infoErr == nil {
			vm.Disks[index].CapacityBytes = uintPointer(info.VirtualSize)
			vm.Disks[index].AllocatedBytes = uintPointer(info.ActualSize)
		}
	}
	interfaceArgs := append(append([]string{}, baseArgs...), "domiflist", name)
	if interfaceOutput, interfaceErr := runVirtualizationCommand(ctx, virsh, interfaceArgs...); interfaceErr == nil {
		vm.Networks = parseLibvirtInterfaceList(interfaceOutput)
	} else {
		return virtualMachineTelemetry{}, interfaceErr
	}
	vm.Guest = collectLibvirtGuestInfo(ctx, virsh, baseArgs, name)
	return vm, nil
}

func collectLibvirtDomainStats(ctx context.Context, virsh string, baseArgs []string, name string) (libvirtDomainStats, error) {
	args := append(append([]string{}, baseArgs...), "domstats", "--raw", "--state", "--balloon", "--block", "--interface", name)
	output, err := runVirtualizationCommand(ctx, virsh, args...)
	if err != nil {
		return libvirtDomainStats{}, err
	}
	values := map[string]uint64{}
	for _, line := range strings.Split(output, "\n") {
		separator := strings.Index(line, "=")
		if separator <= 0 {
			continue
		}
		value, parseErr := strconv.ParseUint(strings.TrimSpace(line[separator+1:]), 10, 64)
		if parseErr == nil {
			values[strings.TrimSpace(line[:separator])] = value
		}
	}
	return libvirtDomainStats{Values: values}, nil
}

func applyLibvirtDomainStats(vm *virtualMachineTelemetry, stats libvirtDomainStats) {
	if value := stats.Values["balloon.maximum"]; value > 0 {
		vm.Memory.ConfiguredBytes = uintPointer(value * 1024)
	}
	if value := stats.Values["balloon.current"]; value > 0 {
		vm.Memory.UsedBytes = uintPointer(value * 1024)
	}
	if value := stats.Values["vcpu.current"]; value > 0 {
		vm.CPU.ConfiguredCores = intPointer(int(value))
	}
	for key, value := range stats.Values {
		switch {
		case strings.HasPrefix(key, "block.") && strings.HasSuffix(key, ".rd.bytes"):
			if vm.Disk == nil {
				vm.Disk = &virtualizationDiskStats{}
			}
			current := value
			if vm.Disk.TotalReadBytes != nil {
				current += *vm.Disk.TotalReadBytes
			}
			vm.Disk.TotalReadBytes = uintPointer(current)
		case strings.HasPrefix(key, "block.") && strings.HasSuffix(key, ".wr.bytes"):
			if vm.Disk == nil {
				vm.Disk = &virtualizationDiskStats{}
			}
			current := value
			if vm.Disk.TotalWriteBytes != nil {
				current += *vm.Disk.TotalWriteBytes
			}
			vm.Disk.TotalWriteBytes = uintPointer(current)
		case strings.HasPrefix(key, "net.") && strings.HasSuffix(key, ".rx.bytes"):
			if vm.Network == nil {
				vm.Network = &virtualizationNetworkStats{}
			}
			current := value
			if vm.Network.TotalRxBytes != nil {
				current += *vm.Network.TotalRxBytes
			}
			vm.Network.TotalRxBytes = uintPointer(current)
		case strings.HasPrefix(key, "net.") && strings.HasSuffix(key, ".tx.bytes"):
			if vm.Network == nil {
				vm.Network = &virtualizationNetworkStats{}
			}
			current := value
			if vm.Network.TotalTxBytes != nil {
				current += *vm.Network.TotalTxBytes
			}
			vm.Network.TotalTxBytes = uintPointer(current)
		}
	}
}

type qemuImageInfo struct {
	VirtualSize uint64 `json:"virtual-size"`
	ActualSize  uint64 `json:"actual-size"`
}

func collectQEMUImageInfo(ctx context.Context, path string) (qemuImageInfo, error) {
	output, err := runVirtualizationCommand(ctx, firstNonEmptyEnv("DSC_VIRTUALIZATION_QEMU_IMG", "DSC_QEMU_IMG", "qemu-img"), "info", "--output=json", path)
	if err != nil {
		return qemuImageInfo{}, err
	}
	var info qemuImageInfo
	if err := json.Unmarshal([]byte(output), &info); err != nil {
		return qemuImageInfo{}, err
	}
	return info, nil
}

func parseLibvirtBlockList(output string) []virtualizationDiskDevice {
	result := []virtualizationDiskDevice{}
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "Type") || strings.HasPrefix(line, "----") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 4 || strings.EqualFold(fields[1], "cdrom") {
			continue
		}
		source := strings.Join(fields[3:], " ")
		result = append(result, virtualizationDiskDevice{
			ID:      fields[2],
			Name:    fields[2],
			Storage: "libvirt",
			Path:    source,
		})
	}
	return result
}

func parseLibvirtInterfaceList(output string) []virtualizationNetworkDevice {
	result := []virtualizationNetworkDevice{}
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "Interface") || strings.HasPrefix(line, "----") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 5 {
			continue
		}
		result = append(result, virtualizationNetworkDevice{
			ID:         fields[0],
			Name:       fields[0],
			Network:    fields[2],
			SwitchName: fields[2],
			MACAddress: fields[4],
		})
	}
	return result
}

func collectLibvirtGuestInfo(ctx context.Context, virsh string, baseArgs []string, name string) *virtualizationGuestInfo {
	guest := &virtualizationGuestInfo{AgentAvailable: false, Source: "libvirt"}
	hostnameArgs := append(append([]string{}, baseArgs...), "domhostname", name)
	if output, err := runVirtualizationCommand(ctx, virsh, hostnameArgs...); err == nil {
		guest.Hostname = strings.TrimSpace(output)
	}
	addrArgs := append(append([]string{}, baseArgs...), "domifaddr", name, "--source", "agent")
	if output, err := runVirtualizationCommand(ctx, virsh, addrArgs...); err == nil {
		for _, line := range strings.Split(output, "\n") {
			for _, token := range strings.Fields(line) {
				ipText := strings.Split(token, "/")[0]
				if parsed := net.ParseIP(ipText); parsed == nil {
					continue
				} else if parsed.To4() != nil {
					guest.IPv4 = append(guest.IPv4, ipText)
				} else {
					guest.IPv6 = append(guest.IPv6, ipText)
				}
			}
		}
		guest.AgentAvailable = len(guest.IPv4) > 0 || len(guest.IPv6) > 0
	}
	return guest
}

func normalizeLibvirtPowerState(state string) string {
	state = strings.ToLower(strings.TrimSpace(state))
	switch {
	case strings.Contains(state, "running"):
		return "running"
	case strings.Contains(state, "paused"):
		return "paused"
	case strings.Contains(state, "shut") || strings.Contains(state, "off"):
		return "stopped"
	default:
		return firstNonEmpty(state, "unknown")
	}
}

func parseColonFields(output string) map[string]string {
	result := map[string]string{}
	for _, line := range strings.Split(output, "\n") {
		separator := strings.Index(line, ":")
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

func parseNonEmptyLines(output string) []string {
	values := []string{}
	for _, line := range strings.Split(output, "\n") {
		if value := strings.TrimSpace(line); value != "" {
			values = append(values, value)
		}
	}
	return values
}

func parseLibvirtBytes(value string) uint64 {
	value = strings.TrimSpace(strings.TrimSuffix(value, "(0 bytes)"))
	if value == "" {
		return 0
	}
	fields := strings.Fields(value)
	if len(fields) == 0 {
		return 0
	}
	number, err := strconv.ParseFloat(strings.ReplaceAll(fields[0], ",", ""), 64)
	if err != nil || number <= 0 {
		return 0
	}
	multiplier := float64(1)
	if len(fields) > 1 {
		switch strings.ToLower(fields[1]) {
		case "kib":
			multiplier = 1024
		case "kbytes":
			multiplier = 1024
		case "mib":
			multiplier = 1024 * 1024
		case "mbytes":
			multiplier = 1024 * 1024
		case "gib":
			multiplier = 1024 * 1024 * 1024
		case "gbytes":
			multiplier = 1024 * 1024 * 1024
		case "tib":
			multiplier = 1024 * 1024 * 1024 * 1024
		case "tbytes":
			multiplier = 1024 * 1024 * 1024 * 1024
		case "pib":
			multiplier = 1024 * 1024 * 1024 * 1024 * 1024
		case "kb":
			multiplier = 1000
		case "mb":
			multiplier = 1000 * 1000
		case "gb":
			multiplier = 1000 * 1000 * 1000
		case "tb":
			multiplier = 1000 * 1000 * 1000 * 1000
		}
	}
	return uint64(number * multiplier)
}

func parseIntField(value string) int {
	fields := strings.Fields(value)
	if len(fields) == 0 {
		return 0
	}
	parsed, err := strconv.Atoi(strings.TrimSpace(fields[0]))
	if err != nil || parsed < 0 {
		return 0
	}
	return parsed
}

func parseUintField(value string) uint64 {
	fields := strings.Fields(value)
	if len(fields) == 0 {
		return 0
	}
	parsed, err := strconv.ParseUint(strings.TrimSpace(fields[0]), 10, 64)
	if err != nil {
		return 0
	}
	return parsed
}

func parseFloatField(value string) float64 {
	fields := strings.Fields(value)
	if len(fields) == 0 {
		return 0
	}
	number := strings.TrimSuffix(strings.TrimSpace(fields[0]), "%")
	parsed, err := strconv.ParseFloat(number, 64)
	if err != nil {
		return 0
	}
	return parsed
}

func runVirtualizationCommand(ctx context.Context, executable string, args ...string) (string, error) {
	command := exec.CommandContext(ctx, executable, args...)
	output, err := command.CombinedOutput()
	if err != nil {
		message := strings.TrimSpace(string(output))
		if len(message) > 2048 {
			message = message[:2048]
		}
		if message == "" {
			return "", fmt.Errorf("%s: %w", executable, err)
		}
		return "", fmt.Errorf("%s: %w: %s", executable, err, message)
	}
	return string(output), nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
