package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestStoragePoolsFromPVEStorage(t *testing.T) {
	resources := []pveStorageResource{
		{
			Storage: "local-lvm",
			Type:    "lvmthin",
			Content: "images,rootdir",
			Active:  1,
			Enabled: 1,
			Total:   865763065856,
			Used:    824119862388,
			Avail:   41643203468,
		},
		{
			Storage: "NAS-VM",
			Type:    "nfs",
			Content: "iso,images",
			Active:  1,
			Enabled: 1,
			Shared:  1,
			Total:   4000648790016,
			Used:    3783181467648,
			Avail:   215757094912,
		},
		{
			Storage: "pve3-hdd",
			Type:    "lvmthin",
			Content: "images,rootdir",
			Active:  0,
			Enabled: 0,
		},
	}
	pools := storagePoolsFromPVEStorage("pve1", resources)
	if len(pools) != 3 {
		t.Fatalf("expected 3 pools, got %d", len(pools))
	}

	byName := map[string]storagePoolStats{}
	for _, pool := range pools {
		byName[pool.Name] = pool
	}

	lvm := byName["local-lvm"]
	if lvm.Kind != storagePoolKindLVMThin {
		t.Fatalf("local-lvm kind = %q", lvm.Kind)
	}
	if lvm.ID != "proxmox:pve1/local-lvm" {
		t.Fatalf("local-lvm id = %q", lvm.ID)
	}
	if lvm.Source != storagePoolSourceProxmox || lvm.Node != "pve1" {
		t.Fatalf("local-lvm source/node = %q/%q", lvm.Source, lvm.Node)
	}
	if lvm.TotalBytes != 865763065856 || lvm.UsedBytes != 824119862388 {
		t.Fatalf("local-lvm capacity = %d/%d", lvm.TotalBytes, lvm.UsedBytes)
	}
	if len(lvm.Content) != 2 || lvm.Content[0] != "images" || lvm.Content[1] != "rootdir" {
		t.Fatalf("local-lvm content = %v", lvm.Content)
	}
	if lvm.Active == nil || !*lvm.Active || lvm.Shared == nil || *lvm.Shared {
		t.Fatalf("local-lvm active/shared = %v/%v", lvm.Active, lvm.Shared)
	}

	nfs := byName["NAS-VM"]
	if nfs.Kind != storagePoolKindNFS {
		t.Fatalf("NAS-VM kind = %q", nfs.Kind)
	}
	if nfs.Shared == nil || !*nfs.Shared {
		t.Fatalf("NAS-VM shared = %v", nfs.Shared)
	}
	if nfs.AvailableBytes == nil || *nfs.AvailableBytes != 215757094912 {
		t.Fatalf("NAS-VM available = %v", nfs.AvailableBytes)
	}

	disabled := byName["pve3-hdd"]
	if disabled.Active == nil || *disabled.Active || disabled.Enabled == nil || *disabled.Enabled {
		t.Fatalf("pve3-hdd should be inactive and disabled: %v/%v", disabled.Active, disabled.Enabled)
	}
	if disabled.TotalBytes != 0 {
		t.Fatalf("pve3-hdd total = %d", disabled.TotalBytes)
	}

	// Usable pools sort before disabled ones; within the usable set thin pools
	// come first.
	if pools[0].Name != "local-lvm" || pools[len(pools)-1].Name != "pve3-hdd" {
		names := make([]string, 0, len(pools))
		for _, pool := range pools {
			names = append(names, pool.Name)
		}
		t.Fatalf("unexpected order: %v", names)
	}
}

func TestStoragePoolKindForProxmoxType(t *testing.T) {
	cases := map[string]string{
		"lvmthin": storagePoolKindLVMThin,
		"lvm":     storagePoolKindLVM,
		"zfspool": storagePoolKindZFS,
		"zfs":     storagePoolKindZFS,
		"dir":     storagePoolKindDir,
		"btrfs":   storagePoolKindDir,
		"nfs":     storagePoolKindNFS,
		"cifs":    storagePoolKindCIFS,
		"pbs":     storagePoolKindPBS,
		"weird":   storagePoolKindUnknown,
		"":        storagePoolKindUnknown,
	}
	for input, expected := range cases {
		if actual := storagePoolKindForProxmoxType(input); actual != expected {
			t.Fatalf("kind(%q) = %q, want %q", input, actual, expected)
		}
	}
}

func TestCollectProxmoxStoragePoolsFromAPI(t *testing.T) {
	var requestedPath string
	var requestedAuth string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requestedPath = request.URL.Path
		requestedAuth = request.Header.Get("Authorization")
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"data":[{"storage":"local-lvm","type":"lvmthin","content":"images,rootdir","active":1,"enabled":1,"shared":0,"total":865763065856,"used":824119862388,"avail":41643203468}]}`))
	}))
	defer server.Close()

	pools, err := collectProxmoxStoragePools(storagePoolProxmoxConfig{
		Endpoint:    server.URL,
		TokenID:     "dsc-agent@pam!dsc-readonly",
		TokenSecret: "secret-value",
		Node:        "pve1",
	})
	if err != nil {
		t.Fatalf("collectProxmoxStoragePools: %v", err)
	}
	if requestedPath != "/nodes/pve1/storage" {
		t.Fatalf("requested path = %q", requestedPath)
	}
	if requestedAuth != "PVEAPIToken=dsc-agent@pam!dsc-readonly=secret-value" {
		t.Fatalf("authorization = %q", requestedAuth)
	}
	if len(pools) != 1 || pools[0].Name != "local-lvm" {
		t.Fatalf("pools = %v", pools)
	}
}

func TestCollectProxmoxStoragePoolsAPIError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		http.Error(writer, "forbidden", http.StatusForbidden)
	}))
	defer server.Close()
	if _, err := collectProxmoxStoragePools(storagePoolProxmoxConfig{
		Endpoint:    server.URL,
		TokenID:     "token",
		TokenSecret: "secret",
		Node:        "pve1",
	}); err == nil {
		t.Fatal("expected an error for a non-2xx response")
	}
}

func TestMergeStoragePoolsFoldsMountIntoProxmoxStorage(t *testing.T) {
	active := true
	proxmox := []storagePoolStats{{
		ID: "proxmox:pve1/NAS-VM", Name: "NAS-VM", Kind: storagePoolKindNFS,
		Source: storagePoolSourceProxmox, Node: "pve1", Active: &active,
		TotalBytes: 4000648790016, UsedBytes: 3783181467648,
	}}
	mountAvailable := uint64(215757094912)
	generic := []storagePoolStats{{
		ID: "mount:/mnt/pve/NAS-VM", Name: "/mnt/pve/NAS-VM", Kind: storagePoolKindNFS,
		Source: storagePoolSourceMount, MountPoint: "/mnt/pve/NAS-VM",
		Device:     "192.168.5.17:/fs/1000/nfs/PVE",
		TotalBytes: 4000648790016, UsedBytes: 3783181467648, AvailableBytes: &mountAvailable,
	}}
	merged := mergeStoragePools(proxmox, generic)
	if len(merged) != 1 {
		t.Fatalf("expected the mount to fold into the Proxmox storage, got %d entries", len(merged))
	}
	if merged[0].Name != "NAS-VM" || merged[0].MountPoint != "/mnt/pve/NAS-VM" {
		t.Fatalf("merged entry = %+v", merged[0])
	}
}

func TestMergeStoragePoolsFoldsLVMThinPoolBySize(t *testing.T) {
	active := true
	proxmox := []storagePoolStats{{
		ID: "proxmox:pve1/local-lvm", Name: "local-lvm", Kind: storagePoolKindLVMThin,
		Source: storagePoolSourceProxmox, Node: "pve1", Active: &active,
		TotalBytes: 865763065856, UsedBytes: 824119862388,
	}}
	generic := []storagePoolStats{{
		ID: "lvm:pve/data", Name: "pve/data", Kind: storagePoolKindLVMThin,
		Source: storagePoolSourceLVM, Device: "/dev/mapper/pve-data",
		VolumeGroup: "pve", ThinPool: "data",
		TotalBytes:      865761755136,
		PhysicalDevices: []string{"nvme0n1"},
	}}
	merged := mergeStoragePools(proxmox, generic)
	if len(merged) != 1 {
		t.Fatalf("expected the thin pool to fold into local-lvm, got %d entries", len(merged))
	}
	pool := merged[0]
	if pool.Name != "local-lvm" || pool.VolumeGroup != "pve" || pool.ThinPool != "data" {
		t.Fatalf("merged entry = %+v", pool)
	}
	if pool.Device != "/dev/mapper/pve-data" || len(pool.PhysicalDevices) != 1 || pool.PhysicalDevices[0] != "nvme0n1" {
		t.Fatalf("enrichment failed: %+v", pool)
	}
	// The Proxmox numbers are authoritative and must survive the merge.
	if pool.TotalBytes != 865763065856 || pool.UsedBytes != 824119862388 {
		t.Fatalf("capacity was overwritten: %d/%d", pool.TotalBytes, pool.UsedBytes)
	}
}

func TestMergeStoragePoolsKeepsUnmatchedEntries(t *testing.T) {
	proxmox := []storagePoolStats{{
		ID: "proxmox:pve1/local-lvm", Name: "local-lvm", Kind: storagePoolKindLVMThin,
		Source: storagePoolSourceProxmox, Node: "pve1",
		TotalBytes: 865763065856, UsedBytes: 824119862388,
	}}
	generic := []storagePoolStats{
		{
			ID: "lvm:data/archive", Name: "data/archive", Kind: storagePoolKindLVM,
			Source: storagePoolSourceLVM, TotalBytes: 2000000000000, UsedBytes: 0,
		},
		{
			ID: "mount:/mnt/backup", Name: "/mnt/backup", Kind: storagePoolKindFilesystem,
			Source: storagePoolSourceMount, MountPoint: "/mnt/backup",
			TotalBytes: 500000000000, UsedBytes: 100000000000,
		},
	}
	merged := mergeStoragePools(proxmox, generic)
	if len(merged) != 3 {
		t.Fatalf("expected 3 entries, got %d: %+v", len(merged), merged)
	}
}

func TestMergeStoragePoolsDoesNotFoldDifferentSizes(t *testing.T) {
	proxmox := []storagePoolStats{{
		ID: "proxmox:pve1/local-lvm", Name: "local-lvm", Kind: storagePoolKindLVMThin,
		Source: storagePoolSourceProxmox, Node: "pve1",
		TotalBytes: 865763065856, UsedBytes: 824119862388,
	}}
	generic := []storagePoolStats{{
		ID: "lvm:other/vol", Name: "other/vol", Kind: storagePoolKindLVM,
		Source: storagePoolSourceLVM, TotalBytes: 100000000000,
	}}
	merged := mergeStoragePools(proxmox, generic)
	if len(merged) != 2 {
		t.Fatalf("a differently sized volume must not fold: %+v", merged)
	}
}

func TestSortStoragePoolsOrder(t *testing.T) {
	active := true
	inactive := false
	pools := []storagePoolStats{
		{ID: "b", Name: "zbackup", Kind: storagePoolKindFilesystem, Active: &active},
		{ID: "c", Name: "pve3-hdd", Kind: storagePoolKindLVMThin, Active: &inactive},
		{ID: "a", Name: "local-lvm", Kind: storagePoolKindLVMThin, Active: &active},
		{ID: "d", Name: "NAS-VM", Kind: storagePoolKindNFS, Active: &active},
	}
	sortStoragePools(pools)
	order := make([]string, 0, len(pools))
	for _, pool := range pools {
		order = append(order, pool.Name)
	}
	want := []string{"local-lvm", "NAS-VM", "zbackup", "pve3-hdd"}
	for index, name := range want {
		if order[index] != name {
			t.Fatalf("order = %v, want %v", order, want)
		}
	}
}

func TestStoragePoolProxmoxInsecureTLS(t *testing.T) {
	t.Setenv("DSC_STORAGE_PVE_INSECURE_TLS", "")
	t.Setenv("DSC_VIRTUALIZATION_INSECURE_TLS", "")
	if !storagePoolProxmoxInsecureTLS("https://127.0.0.1:8006/api2/json") {
		t.Fatal("loopback endpoints must default to skipping TLS verification")
	}
	if storagePoolProxmoxInsecureTLS("https://pve1.example:8006/api2/json") {
		t.Fatal("remote endpoints must not skip TLS verification by default")
	}
	t.Setenv("DSC_STORAGE_PVE_INSECURE_TLS", "true")
	if !storagePoolProxmoxInsecureTLS("https://pve1.example:8006/api2/json") {
		t.Fatal("an explicit opt-in must be honoured")
	}
}

func TestStoragePoolProxmoxConfigFromEnvFallsBackToLegacyNames(t *testing.T) {
	t.Setenv("DSC_STORAGE_PVE_TOKEN_ID", "")
	t.Setenv("DSC_STORAGE_PVE_TOKEN_SECRET", "")
	t.Setenv("DSC_STORAGE_PVE_ENDPOINT", "")
	t.Setenv("DSC_VIRTUALIZATION_TOKEN_ID", "dsc-agent@pam!dsc-readonly")
	t.Setenv("DSC_VIRTUALIZATION_TOKEN_SECRET", "legacy-secret")
	t.Setenv("DSC_VIRTUALIZATION_ENDPOINT", "https://127.0.0.1:8006/api2/json")
	cfg := storagePoolProxmoxConfigFromEnv()
	if cfg.TokenID != "dsc-agent@pam!dsc-readonly" || cfg.TokenSecret != "legacy-secret" {
		t.Fatalf("legacy token env was not honoured: %+v", cfg)
	}
	if cfg.Endpoint != "https://127.0.0.1:8006/api2/json" {
		t.Fatalf("legacy endpoint env was not honoured: %+v", cfg)
	}
}

func TestStoragePoolProxmoxMountPath(t *testing.T) {
	if got := storagePoolProxmoxMountPath("NAS-VM"); got != "/mnt/pve/NAS-VM" {
		t.Fatalf("mount path = %q", got)
	}
	if got := storagePoolProxmoxMountPath("  "); got != "" {
		t.Fatalf("blank storage name must not produce a path: %q", got)
	}
}

func TestStoragePoolBool(t *testing.T) {
	for _, value := range []string{"1", "true", "TRUE", "yes", "on"} {
		if !storagePoolBool(value) {
			t.Fatalf("storagePoolBool(%q) = false", value)
		}
	}
	for _, value := range []string{"0", "false", "no", "off", ""} {
		if storagePoolBool(value) {
			t.Fatalf("storagePoolBool(%q) = true", value)
		}
	}
}
