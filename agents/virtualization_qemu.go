package main

import (
	"context"
	"encoding/json"
	"fmt"
	"runtime"
	"strconv"
	"strings"
)

type qemuProcessRecord struct {
	PID         int    `json:"pid"`
	CommandLine string `json:"commandLine"`
}

func collectQEMUProcessSnapshot(ctx context.Context, cfg agentVirtualizationConfig) (*virtualizationSnapshot, error) {
	processes, err := listQEMUProcesses(ctx)
	if err != nil {
		return nil, err
	}
	snapshot := &virtualizationSnapshot{
		Platform:     "qemu",
		Source:       "qemu-process",
		CollectedAt:  timeNowUTC(),
		Nodes:        []virtualizationNodeTelemetry{},
		VMs:          []virtualMachineTelemetry{},
		Capabilities: []string{"process_inventory", "qemu_commandline", "vm_cpu", "vm_memory", "vm_disk", "vm_network"},
		Issues:       []virtualizationIssue{},
	}
	snapshot.Nodes = append(snapshot.Nodes, virtualizationNodeTelemetry{
		ID:       firstNonEmpty(runtime.GOOS, "qemu-host"),
		Name:     firstNonEmpty(runtime.GOOS, "qemu-host"),
		Platform: "qemu",
		Status:   "online",
		CPU: &virtualizationCPUStats{
			ConfiguredCores: intPointer(runtime.NumCPU()),
		},
	})
	for _, process := range processes {
		vm := parseQEMUProcess(process)
		for index := range vm.Disks {
			if info, infoErr := collectQEMUImageInfo(ctx, vm.Disks[index].Path); infoErr == nil {
				vm.Disks[index].CapacityBytes = uintPointer(info.VirtualSize)
				vm.Disks[index].AllocatedBytes = uintPointer(info.ActualSize)
			}
		}
		snapshot.VMs = append(snapshot.VMs, vm)
	}
	if len(processes) == 0 {
		snapshot.Issues = append(snapshot.Issues, virtualizationIssue{Code: "qemu_processes_not_found", Message: "no qemu-system process was found", Retryable: false})
	}
	return snapshot, nil
}

func listQEMUProcesses(ctx context.Context) ([]qemuProcessRecord, error) {
	if runtime.GOOS == "windows" {
		script := `Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'qemu-system*' -or $_.Name -eq 'qemu-kvm.exe' } | Select-Object @{Name='pid';Expression={$_.ProcessId}}, @{Name='commandLine';Expression={$_.CommandLine}} | ConvertTo-Json -Depth 4 -Compress`
		output, err := runWindowsPowerShell(ctx, script)
		if err != nil {
			return nil, fmt.Errorf("qemu process list: %w", err)
		}
		return parseQEMUProcessJSON(output), nil
	}
	output, err := runVirtualizationCommand(ctx, "ps", "-eo", "pid=,args=")
	if err != nil {
		return nil, fmt.Errorf("qemu process list: %w", err)
	}
	result := []qemuProcessRecord{}
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		pid, parseErr := strconv.Atoi(fields[0])
		if parseErr != nil {
			continue
		}
		commandLine := strings.TrimSpace(line[len(fields[0]):])
		if !strings.Contains(commandLine, "qemu-system") && !strings.Contains(commandLine, "qemu-kvm") {
			continue
		}
		result = append(result, qemuProcessRecord{PID: pid, CommandLine: commandLine})
	}
	return result, nil
}

func parseQEMUProcessJSON(output []byte) []qemuProcessRecord {
	trimmed := strings.TrimSpace(string(output))
	if trimmed == "" || trimmed == "null" {
		return []qemuProcessRecord{}
	}
	if strings.HasPrefix(trimmed, "{") {
		var record qemuProcessRecord
		if json.Unmarshal([]byte(trimmed), &record) == nil {
			return []qemuProcessRecord{record}
		}
	}
	var records []qemuProcessRecord
	if json.Unmarshal([]byte(trimmed), &records) != nil {
		return []qemuProcessRecord{}
	}
	return records
}

func parseQEMUProcess(process qemuProcessRecord) virtualMachineTelemetry {
	tokens := strings.Fields(process.CommandLine)
	name := "qemu-" + strconv.Itoa(process.PID)
	if value := qemuOptionValue(tokens, "-name"); value != "" {
		name = normalizeQEMUName(value)
	}
	cores := parseQEMUCoreCount(qemuOptionValue(tokens, "-smp"))
	memory := parseQEMUMemory(qemuOptionValue(tokens, "-m"))
	vm := virtualMachineTelemetry{
		ID:         strconv.Itoa(process.PID),
		Name:       name,
		Platform:   "qemu",
		Type:       "process",
		PowerState: "running",
		CPU: &virtualizationCPUStats{
			ConfiguredCores: intPointer(cores),
		},
		Memory: &virtualizationMemoryStats{
			ConfiguredBytes: uintPointer(memory),
		},
		Disks:    []virtualizationDiskDevice{},
		Networks: []virtualizationNetworkDevice{},
	}
	for index, token := range tokens {
		if strings.HasPrefix(token, "-drive=") {
			if disk, ok := parseQEMUDrive(strings.TrimPrefix(token, "-drive="), "drive"); ok {
				vm.Disks = append(vm.Disks, disk)
			}
		} else if token == "-drive" && index+1 < len(tokens) {
			if disk, ok := parseQEMUDrive(tokens[index+1], "drive"); ok {
				vm.Disks = append(vm.Disks, disk)
			}
		} else if strings.HasPrefix(token, "-blockdev=") {
			if disk, ok := parseQEMUBlockdev(strings.TrimPrefix(token, "-blockdev="), fmt.Sprintf("blockdev-%d", index)); ok {
				vm.Disks = append(vm.Disks, disk)
			}
		} else if token == "-blockdev" && index+1 < len(tokens) {
			if disk, ok := parseQEMUBlockdev(tokens[index+1], fmt.Sprintf("blockdev-%d", index)); ok {
				vm.Disks = append(vm.Disks, disk)
			}
		} else if strings.HasPrefix(token, "-hda=") || strings.HasPrefix(token, "-hdb=") || strings.HasPrefix(token, "-hdc=") || strings.HasPrefix(token, "-hdd=") {
			path := strings.SplitN(token, "=", 2)[1]
			vm.Disks = append(vm.Disks, virtualizationDiskDevice{ID: token[:4], Name: token[:4], Storage: "qemu", Path: path})
		} else if (token == "-hda" || token == "-hdb" || token == "-hdc" || token == "-hdd") && index+1 < len(tokens) {
			vm.Disks = append(vm.Disks, virtualizationDiskDevice{ID: token, Name: token, Storage: "qemu", Path: tokens[index+1]})
		}
	}
	for index, token := range tokens {
		if strings.HasPrefix(token, "-netdev=") {
			vm.Networks = append(vm.Networks, parseQEMUNetdev(strings.TrimPrefix(token, "-netdev="), fmt.Sprintf("netdev-%d", index)))
		} else if token == "-netdev" && index+1 < len(tokens) {
			vm.Networks = append(vm.Networks, parseQEMUNetdev(tokens[index+1], fmt.Sprintf("netdev-%d", index)))
		} else if strings.HasPrefix(token, "-nic=") {
			vm.Networks = append(vm.Networks, parseQEMUNetdev(strings.TrimPrefix(token, "-nic="), fmt.Sprintf("nic-%d", index)))
		}
	}
	return vm
}

func qemuOptionValue(tokens []string, option string) string {
	for index, token := range tokens {
		if strings.HasPrefix(token, option+"=") {
			return strings.TrimPrefix(token, option+"=")
		}
		if token == option && index+1 < len(tokens) {
			return tokens[index+1]
		}
	}
	return ""
}

func normalizeQEMUName(value string) string {
	value = strings.Trim(value, "\"")
	for _, prefix := range []string{"guest=", "id="} {
		value = strings.TrimPrefix(value, prefix)
	}
	if separator := strings.Index(value, ","); separator >= 0 {
		value = value[:separator]
	}
	return firstNonEmpty(value, "qemu")
}

func parseQEMUCoreCount(value string) int {
	if value == "" {
		return 0
	}
	if separator := strings.Index(value, ","); separator >= 0 {
		value = value[:separator]
	}
	if strings.Contains(value, "=") {
		value = strings.TrimPrefix(value[strings.Index(value, "=")+1:], "=")
	}
	return parseIntField(value)
}

func parseQEMUMemory(value string) uint64 {
	value = strings.TrimSpace(strings.ToUpper(value))
	if value == "" {
		return 0
	}
	if separator := strings.Index(value, ","); separator >= 0 {
		value = value[:separator]
	}
	if separator := strings.Index(value, "="); separator >= 0 {
		key := strings.TrimSpace(value[:separator])
		if key == "SIZE" || key == "MEMORY" {
			value = strings.TrimSpace(value[separator+1:])
		}
	}
	if strings.HasSuffix(value, "K") || strings.HasSuffix(value, "M") || strings.HasSuffix(value, "G") || strings.HasSuffix(value, "T") || strings.HasSuffix(value, "P") {
		return parsePVESizeBytes(value)
	}
	return parsePVESizeBytes(value + "M")
}

func parseQEMUBlockdev(value, id string) (virtualizationDiskDevice, bool) {
	var spec struct {
		Driver   string `json:"driver"`
		Filename string `json:"filename"`
		NodeName string `json:"node-name"`
	}
	if err := json.Unmarshal([]byte(value), &spec); err != nil || strings.TrimSpace(spec.Filename) == "" || !strings.EqualFold(spec.Driver, "file") {
		return virtualizationDiskDevice{}, false
	}
	path := strings.TrimSpace(spec.Filename)
	lowerPath := strings.ToLower(path)
	lowerNode := strings.ToLower(spec.NodeName)
	if strings.HasSuffix(lowerPath, ".iso") || strings.HasSuffix(lowerPath, ".fd") || strings.Contains(lowerNode, "pflash") || strings.Contains(lowerNode, "cdrom") || strings.Contains(lowerNode, "seed") {
		return virtualizationDiskDevice{}, false
	}
	return virtualizationDiskDevice{ID: firstNonEmpty(spec.NodeName, id), Name: firstNonEmpty(spec.NodeName, id), Storage: "qemu", Path: path}, true
}

func parseQEMUDrive(value, id string) (virtualizationDiskDevice, bool) {
	attributes := parsePVEAttributes(strings.Split(value, ","))
	path := attributes["file"]
	if path == "" || strings.EqualFold(attributes["media"], "cdrom") {
		return virtualizationDiskDevice{}, false
	}
	return virtualizationDiskDevice{ID: id, Name: id, Storage: "qemu", Path: path}, true
}

func parseQEMUNetdev(value, id string) virtualizationNetworkDevice {
	parts := strings.Split(value, ",")
	attributes := parsePVEAttributes(parts)
	if len(parts) > 0 && !strings.Contains(parts[0], "=") {
		attributes["type"] = strings.TrimSpace(parts[0])
	}
	return virtualizationNetworkDevice{ID: id, Name: id, Network: attributes["type"], Bridge: attributes["br"], SwitchName: attributes["bridge"]}
}
