package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

type hyperVSnapshotEnvelope struct {
	Host hyperVHostRecord `json:"host"`
	VMs  []hyperVVMRecord `json:"vms"`
}

type hyperVHostRecord struct {
	Name            string  `json:"name"`
	CPUCount        int     `json:"cpuCount"`
	CPUUsagePercent float64 `json:"cpuUsagePercent"`
	TotalMemory     uint64  `json:"totalMemory"`
	FreeMemory      uint64  `json:"freeMemory"`
	DiskTotal       uint64  `json:"diskTotal"`
	DiskFree        uint64  `json:"diskFree"`
	NetworkRxBytes  uint64  `json:"networkRxBytes"`
	NetworkTxBytes  uint64  `json:"networkTxBytes"`
}

type hyperVVMRecord struct {
	ID                  string                `json:"id"`
	Name                string                `json:"name"`
	State               string                `json:"state"`
	CPUCount            int                   `json:"cpuCount"`
	CPUUsagePercent     float64               `json:"cpuUsagePercent"`
	MemoryStartupBytes  uint64                `json:"memoryStartupBytes"`
	MemoryAssignedBytes uint64                `json:"memoryAssignedBytes"`
	MemoryDemandBytes   uint64                `json:"memoryDemandBytes"`
	Disks               []hyperVDiskRecord    `json:"disks"`
	Networks            []hyperVNetworkRecord `json:"networks"`
}

type hyperVDiskRecord struct {
	ID             string `json:"id"`
	Path           string `json:"path"`
	CapacityBytes  uint64 `json:"capacityBytes"`
	AllocatedBytes uint64 `json:"allocatedBytes"`
}

type hyperVNetworkRecord struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	MACAddress string `json:"macAddress"`
	SwitchName string `json:"switchName"`
}

func collectHyperVSnapshot(ctx context.Context, cfg agentVirtualizationConfig) (*virtualizationSnapshot, error) {
	script := `
$ErrorActionPreference = 'Stop'
$computer = Get-CimInstance Win32_ComputerSystem
$operatingSystem = Get-CimInstance Win32_OperatingSystem
$logicalDisks = @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3")
$adapterStats = @(Get-NetAdapterStatistics -ErrorAction SilentlyContinue)
$cpuUsage = 0
try { $cpuUsage = [double](Get-Counter '\Processor(_Total)\% Processor Time').CounterSamples[0].CookedValue } catch {}
$vms = @(Get-VM | ForEach-Object {
  $vm = $_
  $processor = Get-VMProcessor -VMName $vm.Name
  $memory = Get-VMMemory -VMName $vm.Name
  $disks = @(Get-VMHardDiskDrive -VMName $vm.Name | ForEach-Object {
    $drive = $_
    $vhd = $null
    try { $vhd = Get-VHD -Path $drive.Path -ErrorAction Stop } catch {}
    [pscustomobject]@{
      id = "$($drive.ControllerType)-$($drive.ControllerNumber)-$($drive.ControllerLocation)"
      path = $drive.Path
      capacityBytes = if ($vhd) { [uint64]$vhd.Size } else { [uint64]0 }
      allocatedBytes = if ($vhd) { [uint64]$vhd.FileSize } else { [uint64]0 }
    }
  })
  $networks = @(Get-VMNetworkAdapter -VMName $vm.Name | ForEach-Object {
    [pscustomobject]@{
      id = $_.Name
      name = $_.Name
      macAddress = $_.MacAddress
      switchName = $_.SwitchName
    }
  })
  [pscustomobject]@{
    id = $vm.Id.ToString()
    name = $vm.Name
    state = $vm.State.ToString()
    cpuCount = [int]$processor.Count
    cpuUsagePercent = [double]$vm.CPUUsage
    memoryStartupBytes = [uint64]$memory.Startup
    memoryAssignedBytes = [uint64]$memory.Assigned
    memoryDemandBytes = [uint64]$memory.Demand
    disks = $disks
    networks = $networks
  }
})
[pscustomobject]@{
  host = [pscustomobject]@{
    name = $env:COMPUTERNAME
    cpuCount = [int]$computer.NumberOfLogicalProcessors
    cpuUsagePercent = $cpuUsage
    totalMemory = [uint64]$computer.TotalPhysicalMemory
    freeMemory = [uint64]$operatingSystem.FreePhysicalMemory * 1KB
    diskTotal = [uint64](($logicalDisks | Measure-Object -Property Size -Sum).Sum)
    diskFree = [uint64](($logicalDisks | Measure-Object -Property FreeSpace -Sum).Sum)
    networkRxBytes = [uint64](($adapterStats | Measure-Object -Property ReceivedBytes -Sum).Sum)
    networkTxBytes = [uint64](($adapterStats | Measure-Object -Property SentBytes -Sum).Sum)
  }
  vms = $vms
} | ConvertTo-Json -Depth 10 -Compress
`
	output, err := runWindowsPowerShell(ctx, script)
	if err != nil {
		return nil, fmt.Errorf("hyper-v PowerShell collection: %w", err)
	}
	var envelope hyperVSnapshotEnvelope
	if err := json.Unmarshal(output, &envelope); err != nil {
		return nil, fmt.Errorf("hyper-v response: %w", err)
	}
	now := timeNowUTC()
	snapshot := &virtualizationSnapshot{
		Platform:     "hyperv",
		Source:       "powershell",
		CollectedAt:  now,
		Nodes:        []virtualizationNodeTelemetry{},
		VMs:          []virtualMachineTelemetry{},
		Capabilities: []string{"vm_inventory", "vm_cpu", "vm_memory", "vm_disk", "vm_network", "hyperv_powershell"},
		Issues:       []virtualizationIssue{},
	}
	hostUsedMemory := envelope.Host.TotalMemory - minUint64(envelope.Host.TotalMemory, envelope.Host.FreeMemory)
	node := virtualizationNodeTelemetry{
		ID:       firstNonEmpty(envelope.Host.Name, "hyperv-host"),
		Name:     firstNonEmpty(envelope.Host.Name, "hyperv-host"),
		Platform: "hyperv",
		Status:   "online",
		CPU: &virtualizationCPUStats{
			ConfiguredCores: intPointer(envelope.Host.CPUCount),
			UsagePercent:    floatPointer(envelope.Host.CPUUsagePercent),
		},
		Memory: &virtualizationMemoryStats{
			ConfiguredBytes: uintPointer(envelope.Host.TotalMemory),
			UsedBytes:       uintPointer(hostUsedMemory),
			AvailableBytes:  uintPointer(envelope.Host.FreeMemory),
		},
		Disk: &virtualizationDiskStats{
			ProvisionedBytes: uintPointer(envelope.Host.DiskTotal),
			UsedBytes:        uintPointer(envelope.Host.DiskTotal - minUint64(envelope.Host.DiskTotal, envelope.Host.DiskFree)),
		},
		Network: &virtualizationNetworkStats{
			TotalRxBytes: uintPointer(envelope.Host.NetworkRxBytes),
			TotalTxBytes: uintPointer(envelope.Host.NetworkTxBytes),
		},
	}
	snapshot.Nodes = append(snapshot.Nodes, node)
	for _, record := range envelope.VMs {
		vm := virtualMachineTelemetry{
			ID:         firstNonEmpty(record.ID, record.Name),
			Name:       record.Name,
			Platform:   "hyperv",
			Node:       node.ID,
			Type:       "vm",
			PowerState: normalizeHyperVPowerState(record.State),
			CPU: &virtualizationCPUStats{
				ConfiguredCores: intPointer(record.CPUCount),
				UsagePercent:    floatPointer(record.CPUUsagePercent),
			},
			Memory: &virtualizationMemoryStats{
				ConfiguredBytes: uintPointer(record.MemoryStartupBytes),
				UsedBytes:       uintPointer(record.MemoryAssignedBytes),
				ActiveBytes:     uintPointer(record.MemoryDemandBytes),
			},
			Disks:    []virtualizationDiskDevice{},
			Networks: []virtualizationNetworkDevice{},
		}
		for _, disk := range record.Disks {
			vm.Disks = append(vm.Disks, virtualizationDiskDevice{
				ID:             firstNonEmpty(disk.ID, disk.Path),
				Name:           firstNonEmpty(disk.ID, disk.Path),
				Path:           disk.Path,
				CapacityBytes:  uintPointer(disk.CapacityBytes),
				AllocatedBytes: uintPointer(disk.AllocatedBytes),
			})
		}
		for _, network := range record.Networks {
			vm.Networks = append(vm.Networks, virtualizationNetworkDevice{
				ID:         network.ID,
				Name:       network.Name,
				MACAddress: normalizeMACAddress(network.MACAddress),
				SwitchName: network.SwitchName,
			})
		}
		snapshot.VMs = append(snapshot.VMs, vm)
	}
	return snapshot, nil
}

func normalizeHyperVPowerState(state string) string {
	switch strings.ToLower(strings.TrimSpace(state)) {
	case "running":
		return "running"
	case "paused", "suspended":
		return "paused"
	case "off", "turnedoff", "saved":
		return "stopped"
	default:
		return firstNonEmpty(state, "unknown")
	}
}

func normalizeMACAddress(value string) string {
	value = strings.ToUpper(strings.TrimSpace(value))
	compact := strings.NewReplacer("-", "", ":", "", ".", "").Replace(value)
	if len(compact) == 12 {
		for _, char := range compact {
			if !((char >= '0' && char <= '9') || (char >= 'A' && char <= 'F')) {
				return value
			}
		}
		parts := make([]string, 0, 6)
		for index := 0; index < len(compact); index += 2 {
			parts = append(parts, compact[index:index+2])
		}
		return strings.Join(parts, ":")
	}
	return strings.ReplaceAll(value, "-", ":")
}

func minUint64(left, right uint64) uint64 {
	if left < right {
		return left
	}
	return right
}
