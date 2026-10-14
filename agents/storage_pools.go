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
	"sort"
	"strings"
	"time"
)

// Storage pools are the host-side entities that back virtual machine disks:
// Proxmox storages, LVM thin pools and volumes, ZFS pools, and mounted
// filesystems including network shares. They are deliberately a separate
// telemetry entity from diskDeviceStats: a pool has no mount point, and its
// "used" number can mean thin-provisioned allocation rather than filesystem
// usage, so folding it into the disk list would corrupt both meanings.
const (
	storagePoolKindLVMThin    = "lvmthin"
	storagePoolKindLVM        = "lvm"
	storagePoolKindZFS        = "zfs"
	storagePoolKindBtrfs      = "btrfs"
	storagePoolKindDir        = "dir"
	storagePoolKindNFS        = "nfs"
	storagePoolKindCIFS       = "cifs"
	storagePoolKindPBS        = "pbs"
	storagePoolKindFilesystem = "filesystem"
	storagePoolKindUnknown    = "unknown"

	storagePoolSourceProxmox = "proxmox"
	storagePoolSourceMount   = "mount"
	storagePoolSourceLVM     = "lvm"
	storagePoolSourceZFS     = "zfs"

	// The Proxmox API call shares the slow-collection budget (15s) with every
	// other probe in the cycle, so it gets a short, explicit timeout.
	storagePoolProxmoxTimeout = 4 * time.Second
)

// storagePoolStats is one storage entity a host can hold virtual machine disks
// on. The optional fields are filled by whichever source observed the entity:
// the Proxmox API supplies storage names, content types and active/shared
// flags; the OS supplies mount points, devices and LVM/ZFS topology.
type storagePoolStats struct {
	ID              string   `json:"id"`
	Name            string   `json:"name"`
	Kind            string   `json:"kind"`
	Source          string   `json:"source"`
	Node            string   `json:"node,omitempty"`
	MountPoint      string   `json:"mountPoint,omitempty"`
	Device          string   `json:"device,omitempty"`
	VolumeGroup     string   `json:"volumeGroup,omitempty"`
	ThinPool        string   `json:"thinPool,omitempty"`
	PhysicalDevices []string `json:"physicalDevices,omitempty"`
	Content         []string `json:"content,omitempty"`
	Active          *bool    `json:"active,omitempty"`
	Enabled         *bool    `json:"enabled,omitempty"`
	Shared          *bool    `json:"shared,omitempty"`
	TotalBytes      uint64   `json:"totalBytes"`
	UsedBytes       uint64   `json:"usedBytes"`
	AvailableBytes  *uint64  `json:"availableBytes,omitempty"`
	DataPercent     *float64 `json:"dataPercent,omitempty"`
	MetadataPercent *float64 `json:"metadataPercent,omitempty"`
	Health          string   `json:"health,omitempty"`
}

// collectStoragePools merges the platform-specific OS view with the Proxmox
// view when the node has a read-only API token configured. The Proxmox entries
// win on conflicts because their names are the ones an operator sees in the
// Proxmox UI; the OS entries then enrich them and contribute everything
// Proxmox does not manage (plain mounts, LVM on non-Proxmox hosts, ZFS).
func collectStoragePools() ([]storagePoolStats, error) {
	generic, genericErr := collectGenericStoragePools()

	cfg := storagePoolProxmoxConfigFromEnv()
	if cfg.TokenID == "" || cfg.TokenSecret == "" {
		return generic, genericErr
	}
	proxmox, proxmoxErr := collectProxmoxStoragePools(cfg)
	if proxmoxErr != nil {
		// A Proxmox failure must not hide the OS view: report both and keep the
		// generic pools so a broken token degrades instead of blanking the list.
		if genericErr != nil {
			return generic, fmt.Errorf("proxmox storage: %w; local storage: %v", proxmoxErr, genericErr)
		}
		return generic, fmt.Errorf("proxmox storage: %w", proxmoxErr)
	}
	return mergeStoragePools(proxmox, generic), genericErr
}

// mergeStoragePools folds the OS view into the Proxmox view. A generic entry
// that describes the same entity as a Proxmox storage is not emitted twice; it
// only fills the fields Proxmox does not expose (mount point, device, LVM
// topology, physical disks).
func mergeStoragePools(primary []storagePoolStats, fallback []storagePoolStats) []storagePoolStats {
	result := append([]storagePoolStats{}, primary...)
	for _, candidate := range fallback {
		matched := -1
		for index := range result {
			if storagePoolMatches(result[index], candidate) {
				matched = index
				break
			}
		}
		if matched < 0 {
			result = append(result, candidate)
			continue
		}
		enrichStoragePool(&result[matched], candidate)
	}
	sortStoragePools(result)
	return result
}

// storagePoolMatches reports whether two entries describe the same entity. The
// match must stay conservative: a wrong fold hides a real pool, while a missed
// fold only shows one entity twice.
func storagePoolMatches(existing storagePoolStats, candidate storagePoolStats) bool {
	existingMount := strings.TrimSpace(existing.MountPoint)
	candidateMount := strings.TrimSpace(candidate.MountPoint)
	if existingMount != "" && candidateMount != "" && existingMount == candidateMount {
		return true
	}
	// Proxmox mounts a storage at /mnt/pve/<storage> on the node it is active
	// on, which is how an NFS/CIFS storage is matched to its mount.
	if existingMount == "" && candidateMount != "" && existing.Source == storagePoolSourceProxmox {
		if candidateMount == storagePoolProxmoxMountPath(existing.Name) {
			return true
		}
	}
	existingDevice := strings.TrimSpace(existing.Device)
	candidateDevice := strings.TrimSpace(candidate.Device)
	if existingDevice != "" && candidateDevice != "" && existingDevice == candidateDevice {
		return true
	}
	// A Proxmox lvmthin storage and the thin pool the OS sees have the same
	// capacity; the OS view cannot report allocation as non-root, so the total
	// is the only shared number.
	if isStoragePoolLVMKind(existing.Kind) && isStoragePoolLVMKind(candidate.Kind) {
		return storagePoolSizeMatches(existing, candidate)
	}
	return false
}

func isStoragePoolLVMKind(kind string) bool {
	return kind == storagePoolKindLVMThin || kind == storagePoolKindLVM
}

func storagePoolSizeMatches(existing storagePoolStats, candidate storagePoolStats) bool {
	if existing.TotalBytes == 0 || candidate.TotalBytes == 0 {
		return false
	}
	totalDelta := float64(existing.TotalBytes) * 0.01
	if totalDelta < 1<<20 {
		totalDelta = 1 << 20
	}
	diff := float64(existing.TotalBytes) - float64(candidate.TotalBytes)
	if diff < 0 {
		diff = -diff
	}
	if diff > totalDelta {
		return false
	}
	// When both sides know the used bytes they must also agree; a thin pool and
	// a same-sized plain volume are different entities.
	if existing.UsedBytes > 0 && candidate.UsedBytes > 0 {
		usedDiff := float64(existing.UsedBytes) - float64(candidate.UsedBytes)
		if usedDiff < 0 {
			usedDiff = -usedDiff
		}
		usedDelta := float64(existing.UsedBytes) * 0.02
		if usedDelta < 1<<20 {
			usedDelta = 1 << 20
		}
		if usedDiff > usedDelta {
			return false
		}
	}
	return true
}

func storagePoolProxmoxMountPath(storageName string) string {
	name := strings.TrimSpace(storageName)
	if name == "" {
		return ""
	}
	return "/mnt/pve/" + name
}

// enrichStoragePool copies the OS observations onto the Proxmox entry without
// overwriting numbers the Proxmox API already reported.
func enrichStoragePool(target *storagePoolStats, candidate storagePoolStats) {
	if target.MountPoint == "" {
		target.MountPoint = candidate.MountPoint
	}
	if target.Device == "" {
		target.Device = candidate.Device
	}
	if target.VolumeGroup == "" {
		target.VolumeGroup = candidate.VolumeGroup
	}
	if target.ThinPool == "" {
		target.ThinPool = candidate.ThinPool
	}
	if len(target.PhysicalDevices) == 0 && len(candidate.PhysicalDevices) > 0 {
		target.PhysicalDevices = append([]string{}, candidate.PhysicalDevices...)
	}
	if target.DataPercent == nil && candidate.DataPercent != nil {
		target.DataPercent = candidate.DataPercent
	}
	if target.MetadataPercent == nil && candidate.MetadataPercent != nil {
		target.MetadataPercent = candidate.MetadataPercent
	}
	if target.Health == "" {
		target.Health = candidate.Health
	}
}

// sortStoragePools keeps the order stable across cycles: usable pools first,
// then by kind and name, so a chart series does not reorder itself.
func sortStoragePools(pools []storagePoolStats) {
	rank := func(pool storagePoolStats) int {
		switch pool.Kind {
		case storagePoolKindLVMThin:
			return 0
		case storagePoolKindLVM, storagePoolKindZFS:
			return 1
		case storagePoolKindNFS, storagePoolKindCIFS, storagePoolKindDir, storagePoolKindPBS:
			return 2
		default:
			return 3
		}
	}
	sort.SliceStable(pools, func(i, j int) bool {
		left, right := pools[i], pools[j]
		leftActive := left.Active == nil || *left.Active
		rightActive := right.Active == nil || *right.Active
		if leftActive != rightActive {
			return leftActive
		}
		if rank(left) != rank(right) {
			return rank(left) < rank(right)
		}
		leftName := strings.ToLower(left.Name)
		rightName := strings.ToLower(right.Name)
		if leftName != rightName {
			return leftName < rightName
		}
		return left.ID < right.ID
	})
}

// --- Proxmox source -------------------------------------------------------

// storagePoolProxmoxConfig is the non-secret endpoint plus the API token. The
// token stays in the service environment (never in the JSON config), matching
// the retired virtualization adapter's contract so the existing
// /etc/guanlan/virtualization.env on the Proxmox nodes keeps working.
type storagePoolProxmoxConfig struct {
	Endpoint    string
	TokenID     string
	TokenSecret string
	Node        string
	InsecureTLS bool
}

func storagePoolProxmoxConfigFromEnv() storagePoolProxmoxConfig {
	cfg := storagePoolProxmoxConfig{
		Endpoint:    storagePoolEnv("DSC_STORAGE_PVE_ENDPOINT", "DSC_VIRTUALIZATION_ENDPOINT", "DSC_PVE_API_URL"),
		TokenID:     storagePoolEnv("DSC_STORAGE_PVE_TOKEN_ID", "DSC_VIRTUALIZATION_TOKEN_ID", "DSC_PVE_TOKEN_ID"),
		TokenSecret: storagePoolEnv("DSC_STORAGE_PVE_TOKEN_SECRET", "DSC_VIRTUALIZATION_TOKEN_SECRET", "DSC_PVE_TOKEN_SECRET"),
		Node:        storagePoolEnv("DSC_STORAGE_PVE_NODE", "DSC_VIRTUALIZATION_NODE"),
	}
	if cfg.Endpoint == "" {
		cfg.Endpoint = "https://127.0.0.1:8006/api2/json"
	}
	cfg.InsecureTLS = storagePoolProxmoxInsecureTLS(cfg.Endpoint)
	return cfg
}

func storagePoolEnv(keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return ""
}

// storagePoolProxmoxInsecureTLS defaults to skipping verification only for the
// loopback endpoint: Proxmox ships a self-signed certificate that cannot match
// 127.0.0.1, and the token never leaves the host on that path. Any remote
// endpoint must opt in explicitly.
func storagePoolProxmoxInsecureTLS(endpoint string) bool {
	if raw := storagePoolEnv("DSC_STORAGE_PVE_INSECURE_TLS", "DSC_VIRTUALIZATION_INSECURE_TLS"); raw != "" {
		return storagePoolBool(raw)
	}
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return false
	}
	host := strings.TrimSpace(parsed.Hostname())
	return host == "127.0.0.1" || host == "::1" || strings.EqualFold(host, "localhost")
}

func storagePoolBool(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

// pveStorageResource is the subset of /nodes/{node}/storage this collector
// consumes. Proxmox reports booleans as 0/1 in the resource list.
type pveStorageResource struct {
	Storage string `json:"storage"`
	Type    string `json:"type"`
	Content string `json:"content"`
	Active  int    `json:"active"`
	Enabled int    `json:"enabled"`
	Shared  int    `json:"shared"`
	Total   uint64 `json:"total"`
	Used    uint64 `json:"used"`
	Avail   uint64 `json:"avail"`
}

func collectProxmoxStoragePools(cfg storagePoolProxmoxConfig) ([]storagePoolStats, error) {
	node := strings.TrimSpace(cfg.Node)
	if node == "" {
		if hostname, err := os.Hostname(); err == nil {
			node = strings.TrimSpace(hostname)
		}
	}
	if node == "" {
		return nil, fmt.Errorf("proxmox node name is unknown")
	}

	ctx, cancel := context.WithTimeout(context.Background(), storagePoolProxmoxTimeout)
	defer cancel()

	client := newStoragePoolHTTPClient(cfg.InsecureTLS)
	body, err := storagePoolPVEGet(ctx, client, cfg, "/nodes/"+url.PathEscape(node)+"/storage")
	if err != nil {
		return nil, err
	}
	var envelope struct {
		Data []pveStorageResource `json:"data"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		return nil, fmt.Errorf("proxmox storage response: %w", err)
	}
	return storagePoolsFromPVEStorage(node, envelope.Data), nil
}

func newStoragePoolHTTPClient(insecureTLS bool) *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if insecureTLS {
		transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}
	}
	return &http.Client{Transport: transport}
}

func storagePoolPVEGet(ctx context.Context, client *http.Client, cfg storagePoolProxmoxConfig, path string) ([]byte, error) {
	endpoint := strings.TrimRight(strings.TrimSpace(cfg.Endpoint), "/")
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+path, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", fmt.Sprintf("PVEAPIToken=%s=%s", cfg.TokenID, cfg.TokenSecret))
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	body, err := readAllLimited(response.Body, 1<<20)
	if err != nil {
		return nil, err
	}
	if response.StatusCode >= 300 {
		return nil, fmt.Errorf("proxmox storage request failed: %s", response.Status)
	}
	return body, nil
}

// storagePoolsFromPVEStorage projects the API resources onto the telemetry
// shape. Disabled storages (a node that is not listed in the storage's nodes
// property) are kept with active=false and a zero capacity so the UI can show
// that the storage exists but is not usable here.
func storagePoolsFromPVEStorage(node string, resources []pveStorageResource) []storagePoolStats {
	pools := make([]storagePoolStats, 0, len(resources))
	for _, resource := range resources {
		name := strings.TrimSpace(resource.Storage)
		if name == "" {
			continue
		}
		active := resource.Active != 0
		enabled := resource.Enabled != 0
		shared := resource.Shared != 0
		pool := storagePoolStats{
			ID:         "proxmox:" + node + "/" + name,
			Name:       name,
			Kind:       storagePoolKindForProxmoxType(resource.Type),
			Source:     storagePoolSourceProxmox,
			Node:       node,
			Active:     &active,
			Enabled:    &enabled,
			Shared:     &shared,
			TotalBytes: resource.Total,
			UsedBytes:  resource.Used,
		}
		if resource.Content != "" {
			for _, entry := range strings.Split(resource.Content, ",") {
				trimmed := strings.TrimSpace(entry)
				if trimmed != "" {
					pool.Content = append(pool.Content, trimmed)
				}
			}
		}
		if resource.Avail > 0 {
			available := resource.Avail
			pool.AvailableBytes = &available
		}
		pools = append(pools, pool)
	}
	sortStoragePools(pools)
	return pools
}

func storagePoolKindForProxmoxType(storageType string) string {
	switch strings.ToLower(strings.TrimSpace(storageType)) {
	case "lvmthin":
		return storagePoolKindLVMThin
	case "lvm":
		return storagePoolKindLVM
	case "zfspool", "zfs":
		return storagePoolKindZFS
	case "dir", "btrfs":
		return storagePoolKindDir
	case "nfs":
		return storagePoolKindNFS
	case "cifs":
		return storagePoolKindCIFS
	case "pbs":
		return storagePoolKindPBS
	case "":
		return storagePoolKindUnknown
	default:
		return storagePoolKindUnknown
	}
}

func readAllLimited(reader io.Reader, limit int64) ([]byte, error) {
	limited := io.LimitReader(reader, limit+1)
	body, err := io.ReadAll(limited)
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > limit {
		return nil, fmt.Errorf("response exceeds %d bytes", limit)
	}
	return body, nil
}
