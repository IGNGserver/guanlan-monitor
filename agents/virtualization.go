package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"
)

type agentVirtualizationConfig struct {
	Enabled               bool   `json:"enabled"`
	Platform              string `json:"platform"`
	Endpoint              string `json:"endpoint"`
	Node                  string `json:"node"`
	InsecureSkipTLSVerify bool   `json:"insecureSkipTlsVerify"`
	PollIntervalSeconds   int    `json:"pollIntervalSeconds"`
}

type virtualizationSnapshot struct {
	Platform          string                        `json:"platform"`
	Source            string                        `json:"source"`
	CollectedAt       string                        `json:"collectedAt"`
	InventoryScope    string                        `json:"inventoryScope,omitempty"`
	InventoryComplete bool                          `json:"inventoryComplete"`
	Nodes             []virtualizationNodeTelemetry `json:"nodes"`
	VMs               []virtualMachineTelemetry     `json:"vms"`
	Storages          []virtualizationStorage       `json:"storages,omitempty"`
	Capabilities      []string                      `json:"capabilities"`
	Issues            []virtualizationIssue         `json:"issues,omitempty"`
}

type virtualizationCounterSample struct {
	ObservedAt   time.Time
	DiskRead     uint64
	HasDiskRead  bool
	DiskWrite    uint64
	HasDiskWrite bool
	NetworkRx    uint64
	HasNetworkRx bool
	NetworkTx    uint64
	HasNetworkTx bool
}

type virtualizationCPUStats struct {
	ConfiguredCores  *int     `json:"configuredCores,omitempty"`
	UsagePercent     *float64 `json:"usagePercent,omitempty"`
	UsageMHz         *float64 `json:"usageMHz,omitempty"`
	DemandMHz        *float64 `json:"demandMHz,omitempty"`
	ReadinessPercent *float64 `json:"readinessPercent,omitempty"`
}

type virtualizationMemoryStats struct {
	ConfiguredBytes *uint64  `json:"configuredBytes,omitempty"`
	UsedBytes       *uint64  `json:"usedBytes,omitempty"`
	AvailableBytes  *uint64  `json:"availableBytes,omitempty"`
	ActiveBytes     *uint64  `json:"activeBytes,omitempty"`
	BalloonedBytes  *uint64  `json:"balloonedBytes,omitempty"`
	SwappedBytes    *uint64  `json:"swappedBytes,omitempty"`
	PressurePercent *float64 `json:"pressurePercent,omitempty"`
}

type virtualizationDiskStats struct {
	ProvisionedBytes *uint64  `json:"provisionedBytes,omitempty"`
	AllocatedBytes   *uint64  `json:"allocatedBytes,omitempty"`
	UsedBytes        *uint64  `json:"usedBytes,omitempty"`
	ReadBytesPerSec  *float64 `json:"readBytesPerSec,omitempty"`
	WriteBytesPerSec *float64 `json:"writeBytesPerSec,omitempty"`
	TotalReadBytes   *uint64  `json:"totalReadBytes,omitempty"`
	TotalWriteBytes  *uint64  `json:"totalWriteBytes,omitempty"`
	ReadOpsPerSec    *float64 `json:"readOpsPerSec,omitempty"`
	WriteOpsPerSec   *float64 `json:"writeOpsPerSec,omitempty"`
	LatencyMs        *float64 `json:"latencyMs,omitempty"`
}

type virtualizationNetworkStats struct {
	RxBytesPerSec *float64 `json:"rxBytesPerSec,omitempty"`
	TxBytesPerSec *float64 `json:"txBytesPerSec,omitempty"`
	TotalRxBytes  *uint64  `json:"totalRxBytes,omitempty"`
	TotalTxBytes  *uint64  `json:"totalTxBytes,omitempty"`
}

type virtualizationDiskDevice struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	Storage          string   `json:"storage,omitempty"`
	Path             string   `json:"path,omitempty"`
	CapacityBytes    *uint64  `json:"capacityBytes,omitempty"`
	AllocatedBytes   *uint64  `json:"allocatedBytes,omitempty"`
	UsedBytes        *uint64  `json:"usedBytes,omitempty"`
	ReadBytesPerSec  *float64 `json:"readBytesPerSec,omitempty"`
	WriteBytesPerSec *float64 `json:"writeBytesPerSec,omitempty"`
	TotalReadBytes   *uint64  `json:"totalReadBytes,omitempty"`
	TotalWriteBytes  *uint64  `json:"totalWriteBytes,omitempty"`
	LatencyMs        *float64 `json:"latencyMs,omitempty"`
}

type virtualizationNetworkDevice struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	MACAddress    string   `json:"macAddress,omitempty"`
	Bridge        string   `json:"bridge,omitempty"`
	SwitchName    string   `json:"switchName,omitempty"`
	Network       string   `json:"network,omitempty"`
	VLAN          *int     `json:"vlan,omitempty"`
	RxBytesPerSec *float64 `json:"rxBytesPerSec,omitempty"`
	TxBytesPerSec *float64 `json:"txBytesPerSec,omitempty"`
	TotalRxBytes  *uint64  `json:"totalRxBytes,omitempty"`
	TotalTxBytes  *uint64  `json:"totalTxBytes,omitempty"`
}

type virtualizationFilesystemDevice struct {
	MountPoint     string  `json:"mountPoint"`
	Filesystem     string  `json:"filesystem,omitempty"`
	TotalBytes     *uint64 `json:"totalBytes,omitempty"`
	UsedBytes      *uint64 `json:"usedBytes,omitempty"`
	AvailableBytes *uint64 `json:"availableBytes,omitempty"`
}

type virtualizationGuestInfo struct {
	Hostname       string                           `json:"hostname,omitempty"`
	IPv4           []string                         `json:"ipv4,omitempty"`
	IPv6           []string                         `json:"ipv6,omitempty"`
	AgentAvailable bool                             `json:"agentAvailable"`
	Source         string                           `json:"source,omitempty"`
	Filesystems    []virtualizationFilesystemDevice `json:"filesystems,omitempty"`
}

type virtualizationStorage struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	Type           string  `json:"type,omitempty"`
	Active         *bool   `json:"active,omitempty"`
	Shared         *bool   `json:"shared,omitempty"`
	TotalBytes     *uint64 `json:"totalBytes,omitempty"`
	UsedBytes      *uint64 `json:"usedBytes,omitempty"`
	AvailableBytes *uint64 `json:"availableBytes,omitempty"`
}

type virtualizationNodeTelemetry struct {
	ID       string                      `json:"id"`
	Name     string                      `json:"name"`
	Platform string                      `json:"platform"`
	Status   string                      `json:"status"`
	Version  string                      `json:"version,omitempty"`
	CPU      *virtualizationCPUStats     `json:"cpu,omitempty"`
	Memory   *virtualizationMemoryStats  `json:"memory,omitempty"`
	Disk     *virtualizationDiskStats    `json:"disk,omitempty"`
	Network  *virtualizationNetworkStats `json:"network,omitempty"`
	Storages []virtualizationStorage     `json:"storages,omitempty"`
}

type virtualMachineTelemetry struct {
	ID         string                        `json:"id"`
	Name       string                        `json:"name"`
	Platform   string                        `json:"platform"`
	Node       string                        `json:"node,omitempty"`
	Type       string                        `json:"type,omitempty"`
	PowerState string                        `json:"powerState"`
	CPU        *virtualizationCPUStats       `json:"cpu,omitempty"`
	Memory     *virtualizationMemoryStats    `json:"memory,omitempty"`
	Disk       *virtualizationDiskStats      `json:"disk,omitempty"`
	Network    *virtualizationNetworkStats   `json:"network,omitempty"`
	Disks      []virtualizationDiskDevice    `json:"disks,omitempty"`
	Networks   []virtualizationNetworkDevice `json:"networks,omitempty"`
	Guest      *virtualizationGuestInfo      `json:"guest,omitempty"`
}

type virtualizationIssue struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Scope     string `json:"scope,omitempty"`
	Retryable bool   `json:"retryable,omitempty"`
}

type pveAPIEnvelope struct {
	Data json.RawMessage `json:"data"`
}

type pveResource struct {
	VMID      int     `json:"vmid"`
	Node      string  `json:"node"`
	Type      string  `json:"type"`
	Status    string  `json:"status"`
	Name      string  `json:"name"`
	MaxCPU    int     `json:"maxcpu"`
	CPU       float64 `json:"cpu"`
	MaxMem    uint64  `json:"maxmem"`
	Mem       uint64  `json:"mem"`
	MaxDisk   uint64  `json:"maxdisk"`
	Disk      uint64  `json:"disk"`
	DiskRead  uint64  `json:"diskread"`
	DiskWrite uint64  `json:"diskwrite"`
	NetIn     uint64  `json:"netin"`
	NetOut    uint64  `json:"netout"`
}

type pveVersion struct {
	Version string `json:"version"`
}

type pveStorageResource struct {
	Storage string `json:"storage"`
	Type    string `json:"type"`
	Active  int    `json:"active"`
	Shared  int    `json:"shared"`
	Total   uint64 `json:"total"`
	Used    uint64 `json:"used"`
	Avail   uint64 `json:"avail"`
}

func newDefaultVirtualizationConfig() agentVirtualizationConfig {
	rawPlatform := strings.TrimSpace(os.Getenv("DSC_VIRTUALIZATION_PLATFORM"))
	platform := strings.ToLower(rawPlatform)
	if platform == "" {
		platform = "auto"
	}
	endpoint := strings.TrimSpace(os.Getenv("DSC_VIRTUALIZATION_ENDPOINT"))
	enabledDefault := rawPlatform != "" || endpoint != ""
	return normalizeVirtualizationConfig(agentVirtualizationConfig{
		Enabled:               parseVirtualizationBool(os.Getenv("DSC_VIRTUALIZATION_ENABLED"), enabledDefault),
		Platform:              platform,
		Endpoint:              endpoint,
		Node:                  strings.TrimSpace(os.Getenv("DSC_VIRTUALIZATION_NODE")),
		InsecureSkipTLSVerify: parseVirtualizationBool(os.Getenv("DSC_VIRTUALIZATION_INSECURE_TLS"), false),
		PollIntervalSeconds:   parseVirtualizationInt(os.Getenv("DSC_VIRTUALIZATION_POLL_SECONDS"), 30),
	})
}

func normalizeVirtualizationConfig(cfg agentVirtualizationConfig) agentVirtualizationConfig {
	cfg.Platform = strings.ToLower(strings.TrimSpace(cfg.Platform))
	if cfg.Platform == "" {
		cfg.Platform = "auto"
	}
	cfg.Endpoint = strings.TrimSpace(cfg.Endpoint)
	cfg.Node = strings.TrimSpace(cfg.Node)
	if cfg.PollIntervalSeconds <= 0 {
		cfg.PollIntervalSeconds = 30
	}
	return cfg
}

func parseVirtualizationBool(value string, fallback bool) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}

func parseVirtualizationInt(value string, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func (s *agentState) collectVirtualization(cfg agentRuntimeConfig, now time.Time) *virtualizationSnapshot {
	virtualizationCfg := normalizeVirtualizationConfig(cfg.Virtualization)
	if !virtualizationCfg.Enabled {
		return nil
	}
	if s.lastVirtualization != nil && !s.lastVirtualizationAt.IsZero() && now.Sub(s.lastVirtualizationAt) < time.Duration(virtualizationCfg.PollIntervalSeconds)*time.Second {
		return s.lastVirtualization
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	snapshot, err := collectVirtualizationProvider(ctx, virtualizationCfg)
	if err != nil {
		if s.lastVirtualization != nil {
			cached := *s.lastVirtualization
			cached.CollectedAt = now.UTC().Format(time.RFC3339)
			cached.Issues = append(cached.Issues, virtualizationIssue{
				Code:      "refresh_failed",
				Message:   err.Error(),
				Retryable: true,
			})
			return &cached
		}
		snapshot = unsupportedVirtualizationSnapshot(virtualizationCfg.Platform, now, err.Error())
	}
	s.applyVirtualizationCounterRates(snapshot, now)
	s.lastVirtualizationAt = now
	s.lastVirtualization = snapshot
	return snapshot
}

func (s *agentState) applyVirtualizationCounterRates(snapshot *virtualizationSnapshot, observedAt time.Time) {
	if snapshot == nil {
		return
	}
	if s.virtualizationCounters == nil {
		s.virtualizationCounters = make(map[string]virtualizationCounterSample)
	}
	activeKeys := make(map[string]struct{}, len(snapshot.VMs))
	for index := range snapshot.VMs {
		vm := &snapshot.VMs[index]
		key := virtualizationCounterKey(snapshot, vm)
		if key == "" {
			continue
		}
		activeKeys[key] = struct{}{}
		current := virtualizationCounterSampleFor(vm, observedAt)
		previous, hasPrevious := s.virtualizationCounters[key]
		if hasPrevious {
			elapsed := observedAt.Sub(previous.ObservedAt).Seconds()
			if rate := counterRate(current.DiskRead, current.HasDiskRead, previous.DiskRead, previous.HasDiskRead, elapsed); rate != nil {
				if vm.Disk == nil {
					vm.Disk = &virtualizationDiskStats{}
				}
				vm.Disk.ReadBytesPerSec = rate
			}
			if rate := counterRate(current.DiskWrite, current.HasDiskWrite, previous.DiskWrite, previous.HasDiskWrite, elapsed); rate != nil {
				if vm.Disk == nil {
					vm.Disk = &virtualizationDiskStats{}
				}
				vm.Disk.WriteBytesPerSec = rate
			}
			if rate := counterRate(current.NetworkRx, current.HasNetworkRx, previous.NetworkRx, previous.HasNetworkRx, elapsed); rate != nil {
				if vm.Network == nil {
					vm.Network = &virtualizationNetworkStats{}
				}
				vm.Network.RxBytesPerSec = rate
			}
			if rate := counterRate(current.NetworkTx, current.HasNetworkTx, previous.NetworkTx, previous.HasNetworkTx, elapsed); rate != nil {
				if vm.Network == nil {
					vm.Network = &virtualizationNetworkStats{}
				}
				vm.Network.TxBytesPerSec = rate
			}
		}
		s.virtualizationCounters[key] = current
	}

	for key := range s.virtualizationCounters {
		if _, ok := activeKeys[key]; !ok {
			delete(s.virtualizationCounters, key)
		}
	}
}

func virtualizationCounterKey(snapshot *virtualizationSnapshot, vm *virtualMachineTelemetry) string {
	if snapshot == nil || vm == nil {
		return ""
	}
	externalID := strings.TrimSpace(vm.ID)
	if externalID == "" {
		externalID = strings.TrimSpace(vm.Name)
	}
	if externalID == "" {
		return ""
	}
	source := strings.TrimSpace(snapshot.Source)
	if source == "" {
		source = strings.TrimSpace(snapshot.Platform)
	}
	return strings.ToLower(strings.TrimSpace(snapshot.Platform)) + "\x00" + source + "\x00" + externalID
}

func virtualizationCounterSampleFor(vm *virtualMachineTelemetry, observedAt time.Time) virtualizationCounterSample {
	sample := virtualizationCounterSample{ObservedAt: observedAt}
	if vm.Disk != nil {
		if vm.Disk.TotalReadBytes != nil {
			sample.DiskRead = *vm.Disk.TotalReadBytes
			sample.HasDiskRead = true
		}
		if vm.Disk.TotalWriteBytes != nil {
			sample.DiskWrite = *vm.Disk.TotalWriteBytes
			sample.HasDiskWrite = true
		}
	}
	if vm.Network != nil {
		if vm.Network.TotalRxBytes != nil {
			sample.NetworkRx = *vm.Network.TotalRxBytes
			sample.HasNetworkRx = true
		}
		if vm.Network.TotalTxBytes != nil {
			sample.NetworkTx = *vm.Network.TotalTxBytes
			sample.HasNetworkTx = true
		}
	}
	return sample
}

func counterRate(current uint64, hasCurrent bool, previous uint64, hasPrevious bool, elapsedSeconds float64) *float64 {
	if !hasCurrent || !hasPrevious || elapsedSeconds <= 0 || current < previous {
		return nil
	}
	rate := float64(current-previous) / elapsedSeconds
	return &rate
}

func collectVirtualizationProvider(ctx context.Context, cfg agentVirtualizationConfig) (*virtualizationSnapshot, error) {
	platform := strings.ToLower(strings.TrimSpace(cfg.Platform))
	if platform == "auto" {
		platform = detectAutoVirtualizationPlatform(ctx)
	}
	switch platform {
	case "proxmox", "pve":
		return collectProxmoxSnapshot(ctx, cfg)
	case "libvirt":
		return collectLibvirtSnapshot(ctx, cfg, platform)
	case "qemu":
		return collectQEMUProcessSnapshot(ctx, cfg)
	case "hyperv", "hyper-v":
		return collectHyperVSnapshot(ctx, cfg)
	case "virtualbox":
		return collectVirtualBoxSnapshot(ctx, cfg)
	case "vsphere":
		return collectVSphereSnapshot(ctx, cfg)
	case "vmware-workstation", "vmware-fusion":
		return collectVMwareSnapshot(ctx, cfg, platform)
	default:
		return nil, fmt.Errorf("unsupported virtualization platform %q", cfg.Platform)
	}
}

func detectAutoVirtualizationPlatform(ctx context.Context) string {
	switch runtime.GOOS {
	case "linux":
		if _, err := os.Stat("/etc/pve"); err == nil {
			return "proxmox"
		}
		if _, err := os.Stat("/var/run/libvirt/libvirt-sock"); err == nil {
			return "libvirt"
		}
		if firstNonEmptyEnv("DSC_VIRTUALIZATION_VIRSH", "DSC_VIRTUALIZATION_LIBVIRT_URI") != "" {
			return "libvirt"
		}
		if virtualizationExecutableAvailable("qemu-system-x86_64", "qemu-kvm", "qemu-system-aarch64") {
			return "qemu"
		}
	case "windows":
		if output, err := runWindowsPowerShell(ctx, "if (Get-Command Get-VM -ErrorAction SilentlyContinue) { 'hyperv' }"); err == nil && strings.TrimSpace(string(output)) != "" {
			return "hyperv"
		}
		if firstNonEmptyEnv("DSC_VIRTUALIZATION_VBOXMANAGE") != "" || virtualizationExecutableAvailable("VBoxManage.exe", "VBoxManage") {
			return "virtualbox"
		}
		if firstNonEmptyEnv("DSC_VIRTUALIZATION_VMRUN", "DSC_VMRUN") != "" || virtualizationExecutableAvailable("vmrun.exe", "vmrun") {
			return "vmware-workstation"
		}
		if virtualizationExecutableAvailable("qemu-system-x86_64.exe", "qemu-system-x86_64") {
			return "qemu"
		}
	case "darwin":
		if firstNonEmptyEnv("DSC_VIRTUALIZATION_VMRUN", "DSC_VMRUN") != "" || virtualizationExecutableAvailable("vmrun") {
			return "vmware-fusion"
		}
		if firstNonEmptyEnv("DSC_VIRTUALIZATION_VBOXMANAGE") != "" || virtualizationExecutableAvailable("VBoxManage") {
			return "virtualbox"
		}
		if virtualizationExecutableAvailable("qemu-system-x86_64", "qemu-system-aarch64") {
			return "qemu"
		}
	}
	return "auto"
}

func virtualizationExecutableAvailable(names ...string) bool {
	for _, name := range names {
		if strings.TrimSpace(name) == "" {
			continue
		}
		if _, err := exec.LookPath(name); err == nil {
			return true
		}
	}
	return false
}

func unsupportedVirtualizationSnapshot(platform string, now time.Time, message string) *virtualizationSnapshot {
	return &virtualizationSnapshot{
		Platform:     platform,
		Source:       "agent",
		CollectedAt:  now.UTC().Format(time.RFC3339),
		Nodes:        []virtualizationNodeTelemetry{},
		VMs:          []virtualMachineTelemetry{},
		Capabilities: []string{},
		Issues:       []virtualizationIssue{{Code: "unsupported", Message: message}},
	}
}

func collectProxmoxSnapshot(ctx context.Context, cfg agentVirtualizationConfig) (*virtualizationSnapshot, error) {
	tokenID := firstNonEmptyEnv("DSC_VIRTUALIZATION_TOKEN_ID", "DSC_PVE_TOKEN_ID")
	tokenSecret := firstNonEmptyEnv("DSC_VIRTUALIZATION_TOKEN_SECRET", "DSC_PVE_TOKEN_SECRET")
	if tokenID == "" || tokenSecret == "" {
		return nil, fmt.Errorf("proxmox token credentials are not configured")
	}
	endpoint := cfg.Endpoint
	if endpoint == "" {
		endpoint = firstNonEmptyEnv("DSC_PVE_API_URL", "DSC_PVE_ENDPOINT")
	}
	if endpoint == "" {
		endpoint = "https://127.0.0.1:8006/api2/json"
	}
	apiClient, err := newPVEAPIClient(endpoint, tokenID, tokenSecret, cfg.InsecureSkipTLSVerify)
	if err != nil {
		return nil, err
	}

	var version pveVersion
	if err := apiClient.get(ctx, "/version", &version); err != nil {
		return nil, fmt.Errorf("proxmox version: %w", err)
	}
	var nodeResources []pveResource
	if err := apiClient.get(ctx, "/cluster/resources?type=node", &nodeResources); err != nil {
		return nil, fmt.Errorf("proxmox node resources: %w", err)
	}
	var vmResources []pveResource
	if err := apiClient.get(ctx, "/cluster/resources?type=vm", &vmResources); err != nil {
		return nil, fmt.Errorf("proxmox vm resources: %w", err)
	}

	now := time.Now().UTC()
	nodeName := strings.TrimSpace(cfg.Node)
	snapshot := &virtualizationSnapshot{
		Platform:          "proxmox",
		Source:            apiClient.endpoint,
		CollectedAt:       now.Format(time.RFC3339),
		InventoryScope:    "cluster",
		InventoryComplete: nodeName == "",
		Nodes:             []virtualizationNodeTelemetry{},
		VMs:               []virtualMachineTelemetry{},
		Storages:          []virtualizationStorage{},
		Capabilities:      []string{"cluster", "nodes", "vm_inventory", "vm_cpu", "vm_memory", "vm_disk", "vm_network", "vm_config"},
		Issues:            []virtualizationIssue{},
	}
	if nodeName != "" {
		snapshot.InventoryScope = "node:" + nodeName
	}
	for _, resource := range nodeResources {
		if cfg.Node != "" && resource.Node != cfg.Node {
			continue
		}
		node := virtualizationNodeTelemetry{
			ID:       resource.Node,
			Name:     resource.Node,
			Platform: "proxmox",
			Status:   resource.Status,
			Version:  version.Version,
			CPU: &virtualizationCPUStats{
				ConfiguredCores: intPointer(resource.MaxCPU),
				UsagePercent:    floatPointer(pveUsagePercent(resource.CPU)),
			},
			Memory: &virtualizationMemoryStats{
				ConfiguredBytes: uintPointer(resource.MaxMem),
				UsedBytes:       uintPointer(resource.Mem),
				AvailableBytes:  uintPointer(resource.MaxMem - minUint64(resource.MaxMem, resource.Mem)),
			},
			Disk: &virtualizationDiskStats{
				ProvisionedBytes: uintPointer(resource.MaxDisk),
				UsedBytes:        uintPointer(resource.Disk),
			},
			Network: &virtualizationNetworkStats{
				TotalRxBytes: uintPointer(resource.NetIn),
				TotalTxBytes: uintPointer(resource.NetOut),
			},
		}
		storages, storageErr := collectProxmoxStorages(ctx, apiClient, resource.Node)
		if storageErr != nil {
			snapshot.Issues = append(snapshot.Issues, virtualizationIssue{Code: "storage_refresh_failed", Message: storageErr.Error(), Scope: resource.Node, Retryable: true})
		} else {
			node.Storages = storages
			snapshot.Storages = append(snapshot.Storages, storages...)
		}
		snapshot.Nodes = append(snapshot.Nodes, node)
	}
	for _, resource := range vmResources {
		if cfg.Node != "" && resource.Node != cfg.Node {
			continue
		}
		vm := virtualMachineTelemetry{
			ID:         fmt.Sprintf("%s/%d", resource.Type, resource.VMID),
			Name:       resource.Name,
			Platform:   "proxmox",
			Node:       resource.Node,
			Type:       resource.Type,
			PowerState: normalizePVEPowerState(resource.Status),
			CPU: &virtualizationCPUStats{
				ConfiguredCores: intPointer(resource.MaxCPU),
				UsagePercent:    floatPointer(pveUsagePercent(resource.CPU)),
			},
			Memory: &virtualizationMemoryStats{
				ConfiguredBytes: uintPointer(resource.MaxMem),
				UsedBytes:       uintPointer(resource.Mem),
			},
			Disk: &virtualizationDiskStats{
				ProvisionedBytes: uintPointer(resource.MaxDisk),
				UsedBytes:        uintPointer(resource.Disk),
				TotalReadBytes:   uintPointerAlways(resource.DiskRead),
				TotalWriteBytes:  uintPointerAlways(resource.DiskWrite),
			},
			Network: &virtualizationNetworkStats{
				TotalRxBytes: uintPointerAlways(resource.NetIn),
				TotalTxBytes: uintPointerAlways(resource.NetOut),
			},
			Disks:    []virtualizationDiskDevice{},
			Networks: []virtualizationNetworkDevice{},
		}
		configPath := fmt.Sprintf("/nodes/%s/%s/%d/config", url.PathEscape(resource.Node), resource.Type, resource.VMID)
		var config map[string]json.RawMessage
		if err := apiClient.get(ctx, configPath, &config); err != nil {
			snapshot.Issues = append(snapshot.Issues, virtualizationIssue{Code: "vm_config_refresh_failed", Message: err.Error(), Scope: vm.ID, Retryable: true})
		} else {
			vm.Disks, vm.Networks = parseProxmoxVMConfig(resource.VMID, config)
		}
		snapshot.VMs = append(snapshot.VMs, vm)
	}
	return snapshot, nil
}

func collectProxmoxStorages(ctx context.Context, apiClient *pveAPIClient, node string) ([]virtualizationStorage, error) {
	var resources []pveStorageResource
	path := fmt.Sprintf("/nodes/%s/storage", url.PathEscape(node))
	if err := apiClient.get(ctx, path, &resources); err != nil {
		return nil, err
	}
	result := make([]virtualizationStorage, 0, len(resources))
	for _, resource := range resources {
		active := resource.Active != 0
		shared := resource.Shared != 0
		result = append(result, virtualizationStorage{
			ID:             resource.Storage,
			Name:           resource.Storage,
			Type:           resource.Type,
			Active:         boolPointer(active),
			Shared:         boolPointer(shared),
			TotalBytes:     uintPointer(resource.Total),
			UsedBytes:      uintPointer(resource.Used),
			AvailableBytes: uintPointer(resource.Avail),
		})
	}
	return result, nil
}

func parseProxmoxVMConfig(vmid int, config map[string]json.RawMessage) ([]virtualizationDiskDevice, []virtualizationNetworkDevice) {
	disks := []virtualizationDiskDevice{}
	networks := []virtualizationNetworkDevice{}
	for key, raw := range config {
		value := pveConfigString(raw)
		switch {
		case isProxmoxDiskKey(key):
			if disk, ok := parseProxmoxDisk(vmid, key, value); ok {
				disks = append(disks, disk)
			}
		case strings.HasPrefix(strings.ToLower(key), "net"):
			if network, ok := parseProxmoxNetwork(vmid, key, value); ok {
				networks = append(networks, network)
			}
		}
	}
	return disks, networks
}

func isProxmoxDiskKey(key string) bool {
	key = strings.ToLower(strings.TrimSpace(key))
	for _, prefix := range []string{"scsi", "virtio", "sata", "ide", "efidisk", "tpmstate"} {
		if !strings.HasPrefix(key, prefix) || key == "scsihw" {
			continue
		}
		suffix := strings.TrimPrefix(key, prefix)
		if suffix == "" {
			continue
		}
		for _, char := range suffix {
			if char < '0' || char > '9' {
				return false
			}
		}
		return true
	}
	return false
}

func parseProxmoxDisk(vmid int, key, value string) (virtualizationDiskDevice, bool) {
	parts := strings.Split(value, ",")
	if len(parts) == 0 || strings.TrimSpace(parts[0]) == "" {
		return virtualizationDiskDevice{}, false
	}
	attributes := parsePVEAttributes(parts[1:])
	if strings.EqualFold(attributes["media"], "cdrom") {
		return virtualizationDiskDevice{}, false
	}
	volume := strings.TrimSpace(parts[0])
	storage := ""
	path := volume
	if separator := strings.Index(volume, ":"); separator > 0 {
		storage = volume[:separator]
		path = volume[separator+1:]
	}
	return virtualizationDiskDevice{
		ID:            fmt.Sprintf("%d-%s", vmid, key),
		Name:          key,
		Storage:       storage,
		Path:          path,
		CapacityBytes: uintPointer(parsePVESizeBytes(attributes["size"])),
	}, true
}

func parseProxmoxNetwork(vmid int, key, value string) (virtualizationNetworkDevice, bool) {
	parts := strings.Split(value, ",")
	if len(parts) == 0 {
		return virtualizationNetworkDevice{}, false
	}
	attributes := parsePVEAttributes(parts)
	if attributes["type"] == "" {
		return virtualizationNetworkDevice{}, false
	}
	network := virtualizationNetworkDevice{
		ID:         fmt.Sprintf("%d-%s", vmid, key),
		Name:       key,
		MACAddress: attributes["mac"],
		Bridge:     attributes["bridge"],
	}
	if tag := parseVirtualizationInt(attributes["tag"], 0); tag > 0 {
		network.VLAN = intPointer(tag)
	}
	return network, true
}

func parsePVEAttributes(parts []string) map[string]string {
	result := map[string]string{}
	for index, part := range parts {
		separator := strings.Index(part, "=")
		if separator <= 0 {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(part[:separator]))
		value := strings.TrimSpace(part[separator+1:])
		if index == 0 && key != "size" && key != "media" && key != "file" {
			result["type"] = key
			result["mac"] = value
			continue
		}
		result[key] = value
	}
	return result
}

func parsePVESizeBytes(value string) uint64 {
	value = strings.TrimSpace(strings.ToUpper(value))
	if value == "" {
		return 0
	}
	multiplier := float64(1)
	for suffix, factor := range map[string]float64{
		"K": 1024,
		"M": 1024 * 1024,
		"G": 1024 * 1024 * 1024,
		"T": 1024 * 1024 * 1024 * 1024,
		"P": 1024 * 1024 * 1024 * 1024 * 1024,
	} {
		if strings.HasSuffix(value, suffix) {
			value = strings.TrimSpace(strings.TrimSuffix(value, suffix))
			multiplier = factor
			break
		}
	}
	number, err := strconv.ParseFloat(value, 64)
	if err != nil || number <= 0 {
		return 0
	}
	return uint64(number * multiplier)
}

func pveConfigString(raw json.RawMessage) string {
	var value string
	if err := json.Unmarshal(raw, &value); err == nil {
		return strings.TrimSpace(value)
	}
	return strings.Trim(strings.TrimSpace(string(raw)), "\"")
}

func normalizePVEPowerState(status string) string {
	status = strings.ToLower(strings.TrimSpace(status))
	switch status {
	case "running", "stopped", "paused", "suspended":
		return status
	default:
		if status == "" {
			return "unknown"
		}
		return status
	}
}

func pveUsagePercent(value float64) float64 {
	if value < 0 {
		return 0
	}
	if value <= 1 {
		value *= 100
	}
	if value > 100 {
		return 100
	}
	return round(value)
}

func firstNonEmptyEnv(keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return ""
}

func uintPointer(value uint64) *uint64 {
	if value == 0 {
		return nil
	}
	return &value
}

func uintPointerAlways(value uint64) *uint64 {
	return &value
}

func floatPointer(value float64) *float64 {
	return &value
}

func boolPointer(value bool) *bool {
	return &value
}

type pveAPIClient struct {
	client        *http.Client
	endpoint      string
	authorization string
}

func newPVEAPIClient(endpoint, tokenID, tokenSecret string, insecureTLS bool) (*pveAPIClient, error) {
	endpoint = strings.TrimRight(strings.TrimSpace(endpoint), "/")
	if endpoint == "" {
		return nil, fmt.Errorf("proxmox endpoint is empty")
	}
	if !strings.HasSuffix(endpoint, "/api2/json") {
		endpoint += "/api2/json"
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if insecureTLS {
		transport.TLSClientConfig = &tls.Config{MinVersion: tls.VersionTLS12, InsecureSkipVerify: true}
	}
	return &pveAPIClient{
		client:        &http.Client{Transport: transport, Timeout: 15 * time.Second},
		endpoint:      endpoint,
		authorization: "PVEAPIToken=" + tokenID + "=" + tokenSecret,
	}, nil
}

func (c *pveAPIClient) get(ctx context.Context, path string, target any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, c.endpoint+path, nil)
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", c.authorization)
	response, err := c.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 16*1024*1024))
	if err != nil {
		return err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("http %d: %s", response.StatusCode, strings.TrimSpace(string(body)))
	}
	var envelope pveAPIEnvelope
	if err := json.Unmarshal(body, &envelope); err != nil {
		return fmt.Errorf("decode response: %w", err)
	}
	if len(envelope.Data) == 0 || string(envelope.Data) == "null" {
		return nil
	}
	if err := json.Unmarshal(envelope.Data, target); err != nil {
		return fmt.Errorf("decode data: %w", err)
	}
	return nil
}
