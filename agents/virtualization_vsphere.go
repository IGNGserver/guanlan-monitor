package main

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type vsphereVMListRecord struct {
	VM            string `json:"vm"`
	Name          string `json:"name"`
	PowerState    string `json:"power_state"`
	CPUCount      int    `json:"cpu_count"`
	MemorySizeMiB uint64 `json:"memory_size_MiB"`
}

type vsphereHostListRecord struct {
	Host          string `json:"host"`
	Name          string `json:"name"`
	Connection    string `json:"connection_state"`
	PowerState    string `json:"power_state"`
	CPUCount      int    `json:"cpu_count"`
	MemorySizeMiB uint64 `json:"memory_size_MiB"`
}

type vsphereDatastoreRecord struct {
	Datastore string `json:"datastore"`
	Name      string `json:"name"`
	Type      string `json:"type"`
	Capacity  uint64 `json:"capacity"`
	FreeSpace uint64 `json:"free_space"`
}

type vsphereVMDetails struct {
	CPU struct {
		Count int `json:"count"`
	} `json:"cpu"`
	Memory struct {
		SizeMiB uint64 `json:"size_MiB"`
	} `json:"memory"`
	Disks map[string]vsphereDiskDetails `json:"disks"`
	NICs  map[string]vsphereNICDetails  `json:"nics"`
}

type vsphereDiskDetails struct {
	Label    string `json:"label"`
	Type     string `json:"type"`
	Capacity uint64 `json:"capacity"`
}

type vsphereNICDetails struct {
	Label      string `json:"label"`
	MACAddress string `json:"mac_address"`
	Backing    struct {
		Network string `json:"network"`
		Type    string `json:"type"`
	} `json:"backing"`
}

type vsphereAPIClient struct {
	client      *http.Client
	baseURL     string
	username    string
	password    string
	token       string
	session     string
	insecureTLS bool
}

func collectVSphereSnapshot(ctx context.Context, cfg agentVirtualizationConfig) (*virtualizationSnapshot, error) {
	endpoint := strings.TrimSpace(cfg.Endpoint)
	if endpoint == "" {
		endpoint = firstNonEmptyEnv("DSC_VSPHERE_ENDPOINT", "DSC_VCENTER_ENDPOINT")
	}
	if endpoint == "" {
		return nil, fmt.Errorf("vSphere endpoint is not configured")
	}
	username := firstNonEmptyEnv("DSC_VSPHERE_USERNAME", "DSC_VCENTER_USERNAME", "DSC_VIRTUALIZATION_USERNAME")
	password := firstNonEmptyEnv("DSC_VSPHERE_PASSWORD", "DSC_VCENTER_PASSWORD", "DSC_VIRTUALIZATION_PASSWORD")
	token := firstNonEmptyEnv("DSC_VSPHERE_TOKEN", "DSC_VCENTER_TOKEN", "DSC_VIRTUALIZATION_TOKEN")
	client, err := newVSphereAPIClient(endpoint, username, password, token, cfg.InsecureSkipTLSVerify)
	if err != nil {
		return nil, err
	}
	if err := client.login(ctx); err != nil {
		return nil, err
	}

	var vmRecords []vsphereVMListRecord
	if err := client.get(ctx, "/api/vcenter/vm", &vmRecords); err != nil {
		return nil, fmt.Errorf("vSphere VM inventory: %w", err)
	}
	var hostRecords []vsphereHostListRecord
	if err := client.get(ctx, "/api/vcenter/host", &hostRecords); err != nil {
		hostRecords = []vsphereHostListRecord{}
	}
	var datastoreRecords []vsphereDatastoreRecord
	if err := client.get(ctx, "/api/vcenter/datastore", &datastoreRecords); err != nil {
		datastoreRecords = []vsphereDatastoreRecord{}
	}

	snapshot := &virtualizationSnapshot{
		Platform:     "vsphere",
		Source:       client.baseURL,
		CollectedAt:  time.Now().UTC().Format(time.RFC3339),
		Nodes:        []virtualizationNodeTelemetry{},
		VMs:          []virtualMachineTelemetry{},
		Storages:     []virtualizationStorage{},
		Capabilities: []string{"vcenter_api", "host_inventory", "vm_inventory", "vm_cpu", "vm_memory", "vm_disk", "vm_network"},
		Issues:       []virtualizationIssue{},
	}
	for _, host := range hostRecords {
		node := virtualizationNodeTelemetry{
			ID:       firstNonEmpty(host.Host, host.Name),
			Name:     firstNonEmpty(host.Name, host.Host),
			Platform: "vsphere",
			Status:   normalizeVSphereHostState(host.Connection, host.PowerState),
			CPU: &virtualizationCPUStats{
				ConfiguredCores: intPointer(host.CPUCount),
			},
			Memory: &virtualizationMemoryStats{
				ConfiguredBytes: uintPointer(host.MemorySizeMiB * 1024 * 1024),
			},
		}
		snapshot.Nodes = append(snapshot.Nodes, node)
	}
	for _, datastore := range datastoreRecords {
		snapshot.Storages = append(snapshot.Storages, virtualizationStorage{
			ID:             firstNonEmpty(datastore.Datastore, datastore.Name),
			Name:           datastore.Name,
			Type:           datastore.Type,
			Active:         boolPointer(true),
			TotalBytes:     uintPointer(datastore.Capacity),
			AvailableBytes: uintPointer(datastore.FreeSpace),
			UsedBytes:      uintPointer(datastore.Capacity - minUint64(datastore.Capacity, datastore.FreeSpace)),
		})
	}
	if len(snapshot.Nodes) == 0 {
		snapshot.Nodes = append(snapshot.Nodes, virtualizationNodeTelemetry{ID: "vcenter", Name: "vcenter", Platform: "vsphere", Status: "online"})
	}
	for _, record := range vmRecords {
		vm := virtualMachineTelemetry{
			ID:         record.VM,
			Name:       record.Name,
			Platform:   "vsphere",
			Type:       "vm",
			PowerState: normalizeVSpherePowerState(record.PowerState),
			CPU: &virtualizationCPUStats{
				ConfiguredCores: intPointer(record.CPUCount),
			},
			Memory: &virtualizationMemoryStats{
				ConfiguredBytes: uintPointer(record.MemorySizeMiB * 1024 * 1024),
			},
			Disks:    []virtualizationDiskDevice{},
			Networks: []virtualizationNetworkDevice{},
		}
		var details vsphereVMDetails
		if err := client.get(ctx, "/api/vcenter/vm/"+url.PathEscape(record.VM), &details); err == nil {
			if details.CPU.Count > 0 {
				vm.CPU.ConfiguredCores = intPointer(details.CPU.Count)
			}
			if details.Memory.SizeMiB > 0 {
				vm.Memory.ConfiguredBytes = uintPointer(details.Memory.SizeMiB * 1024 * 1024)
			}
			for id, disk := range details.Disks {
				vm.Disks = append(vm.Disks, virtualizationDiskDevice{ID: id, Name: firstNonEmpty(disk.Label, id), Storage: disk.Type, CapacityBytes: uintPointer(disk.Capacity)})
			}
			for id, network := range details.NICs {
				vm.Networks = append(vm.Networks, virtualizationNetworkDevice{ID: id, Name: firstNonEmpty(network.Label, id), MACAddress: normalizeMACAddress(network.MACAddress), Network: network.Backing.Type, SwitchName: network.Backing.Network})
			}
		} else {
			snapshot.Issues = append(snapshot.Issues, virtualizationIssue{Code: "vm_detail_refresh_failed", Message: err.Error(), Scope: record.VM, Retryable: true})
		}
		snapshot.VMs = append(snapshot.VMs, vm)
	}
	return snapshot, nil
}

func newVSphereAPIClient(endpoint, username, password, token string, insecureTLS bool) (*vsphereAPIClient, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(endpoint), "/")
	baseURL = strings.TrimSuffix(baseURL, "/rest")
	baseURL = strings.TrimSuffix(baseURL, "/api")
	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("invalid vSphere endpoint")
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if insecureTLS {
		transport.TLSClientConfig = &tls.Config{MinVersion: tls.VersionTLS12, InsecureSkipVerify: true}
	}
	return &vsphereAPIClient{
		client:      &http.Client{Transport: transport, Timeout: 15 * time.Second},
		baseURL:     baseURL,
		username:    username,
		password:    password,
		token:       token,
		insecureTLS: insecureTLS,
	}, nil
}

func (c *vsphereAPIClient) login(ctx context.Context) error {
	if c.token != "" {
		return nil
	}
	if c.username == "" || c.password == "" {
		return fmt.Errorf("vSphere username/password or token is not configured")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/api/session", nil)
	if err != nil {
		return err
	}
	credentials := base64.StdEncoding.EncodeToString([]byte(c.username + ":" + c.password))
	request.Header.Set("Authorization", "Basic "+credentials)
	response, err := c.client.Do(request)
	if err != nil {
		return fmt.Errorf("vSphere session: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("vSphere session: http %d", response.StatusCode)
	}
	var session string
	if err := json.NewDecoder(response.Body).Decode(&session); err != nil {
		return fmt.Errorf("vSphere session response: %w", err)
	}
	c.session = session
	return nil
}

func (c *vsphereAPIClient) get(ctx context.Context, path string, target any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return err
	}
	if c.token != "" {
		request.Header.Set("Authorization", "Bearer "+c.token)
	} else if c.session != "" {
		request.Header.Set("vmware-api-session-id", c.session)
	}
	response, err := c.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("http %d", response.StatusCode)
	}
	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		return err
	}
	return nil
}

func normalizeVSpherePowerState(state string) string {
	switch strings.ToLower(strings.TrimSpace(state)) {
	case "powered_on", "on", "running":
		return "running"
	case "suspended", "suspend", "paused":
		return "paused"
	case "powered_off", "off", "stopped":
		return "stopped"
	default:
		return firstNonEmpty(state, "unknown")
	}
}

func normalizeVSphereHostState(connection, power string) string {
	if strings.EqualFold(strings.TrimSpace(connection), "connected") {
		return "online"
	}
	return normalizeVSpherePowerState(power)
}
