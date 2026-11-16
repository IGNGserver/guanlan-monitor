package collector

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
)

const (
	minGzipPayloadBytes          = 512
	fullInventoryResendInterval  = 10 * time.Minute
	cpuTopologyCacheRefreshEvery = hardwareAssetCacheTTL
)

var gzipWriterPool = sync.Pool{
	New: func() any {
		writer, _ := gzip.NewWriterLevel(io.Discard, gzip.BestSpeed)
		return writer
	},
}

func compressGzipPayload(raw []byte) ([]byte, error) {
	var buf bytes.Buffer
	buf.Grow(len(raw) / 3)
	writer := gzipWriterPool.Get().(*gzip.Writer)
	writer.Reset(&buf)
	if _, err := writer.Write(raw); err != nil {
		writer.Reset(io.Discard)
		gzipWriterPool.Put(writer)
		return nil, err
	}
	if err := writer.Close(); err != nil {
		writer.Reset(io.Discard)
		gzipWriterPool.Put(writer)
		return nil, err
	}
	writer.Reset(io.Discard)
	gzipWriterPool.Put(writer)
	return buf.Bytes(), nil
}

func newAgentHTTPClient() *http.Client {
	transport := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout:   6 * time.Second,
			KeepAlive: 45 * time.Second,
		}).DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          4,
		MaxIdleConnsPerHost:   2,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   8 * time.Second,
		ExpectContinueTimeout: time.Second,
		ResponseHeaderTimeout: 10 * time.Second,
	}
	return &http.Client{
		Timeout:   10 * time.Second,
		Transport: transport,
	}
}

type hubIngestCapabilities struct {
	Gzip           bool `json:"gzip,omitempty"`
	LiveOnDemand   bool `json:"liveOnDemand,omitempty"`
	InventoryDelta bool `json:"inventoryDelta,omitempty"`
}

type hubIngestResponse struct {
	OK            bool                   `json:"ok"`
	Capabilities  *hubIngestCapabilities `json:"capabilities,omitempty"`
	LiveWanted    *bool                  `json:"liveWanted,omitempty"`
	NeedInventory bool                   `json:"needInventory,omitempty"`
}

// hubSessionState tracks per-Hub transport capabilities negotiated through
// /api/agent/ingest responses. Capabilities default to false so older Hubs and
// plain HTTP stubs continue to receive uncompressed, full-inventory payloads
// and persistent live connections.
type hubSessionState struct {
	mu                      sync.Mutex
	serverURL               string
	gzipSupported           bool
	liveOnDemand            bool
	liveWanted              bool
	inventoryDeltaSupported bool
	ackedDeviceID           string
	ackedInventoryHash      string
	lastFullInventoryAt     time.Time
	liveWake                chan struct{}
}

func newHubSessionState() *hubSessionState {
	return &hubSessionState{
		liveWake: make(chan struct{}, 1),
	}
}

func (s *hubSessionState) ensureLocked(normalizedServerURL string) {
	if s.liveWake == nil {
		s.liveWake = make(chan struct{}, 1)
	}
	if s.serverURL != normalizedServerURL {
		s.serverURL = normalizedServerURL
		s.gzipSupported = false
		s.liveOnDemand = false
		s.liveWanted = false
		s.inventoryDeltaSupported = false
		s.ackedDeviceID = ""
		s.ackedInventoryHash = ""
		s.lastFullInventoryAt = time.Time{}
	}
}

func (s *hubSessionState) liveWakeChan() <-chan struct{} {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.liveWake == nil {
		s.liveWake = make(chan struct{}, 1)
	}
	return s.liveWake
}

func (s *hubSessionState) liveDemand() (onDemand bool, wanted bool) {
	if s == nil {
		return false, true
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.liveOnDemand, s.liveWanted
}

func (s *hubSessionState) useGzip(normalizedServerURL string) bool {
	if s == nil {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ensureLocked(normalizedServerURL)
	return s.gzipSupported
}

func (s *hubSessionState) disableGzip(normalizedServerURL string) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.serverURL == normalizedServerURL {
		s.gzipSupported = false
	}
}

func (s *hubSessionState) prepareWirePayload(normalizedServerURL string, payload metricsPayload, now time.Time) (wire metricsPayload, fullHash string) {
	fullHash = computeInventoryHash(payload)
	if s == nil {
		return payload, fullHash
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ensureLocked(normalizedServerURL)
	deviceID := payload.Identity.DeviceID
	canOmit := s.inventoryDeltaSupported &&
		fullHash != "" &&
		s.ackedDeviceID == deviceID &&
		s.ackedInventoryHash == fullHash &&
		!s.lastFullInventoryAt.IsZero() &&
		now.Sub(s.lastFullInventoryAt) < fullInventoryResendInterval
	if !canOmit {
		wire = payload
		wire.InventoryHash = fullHash
		wire.InventoryOmitted = false
		return wire, fullHash
	}
	return stripStaticInventoryFields(payload, fullHash), fullHash
}

func (s *hubSessionState) observeResponse(normalizedServerURL, deviceID, fullHash string, sentFull bool, resp hubIngestResponse, now time.Time) (needInventoryRetry bool) {
	if s == nil {
		return false
	}
	s.mu.Lock()
	var shouldWake bool
	s.ensureLocked(normalizedServerURL)
	if resp.Capabilities != nil {
		s.gzipSupported = resp.Capabilities.Gzip
		s.liveOnDemand = resp.Capabilities.LiveOnDemand
		s.inventoryDeltaSupported = resp.Capabilities.InventoryDelta
	}
	if resp.LiveWanted != nil {
		prevWanted := s.liveWanted
		s.liveWanted = *resp.LiveWanted
		if s.liveWanted && !prevWanted {
			shouldWake = true
		}
	}
	if resp.NeedInventory {
		s.ackedInventoryHash = ""
		s.lastFullInventoryAt = time.Time{}
		needInventoryRetry = !sentFull
	} else if fullHash != "" {
		s.ackedDeviceID = deviceID
		if sentFull {
			s.ackedInventoryHash = fullHash
			s.lastFullInventoryAt = now
		}
	}
	wakeCh := s.liveWake
	s.mu.Unlock()

	if shouldWake && wakeCh != nil {
		select {
		case wakeCh <- struct{}{}:
		default:
		}
	}
	return needInventoryRetry
}

func stripStaticInventoryFields(payload metricsPayload, inventoryHash string) metricsPayload {
	out := cloneMetricsPayload(payload)
	out.InventoryHash = inventoryHash
	out.InventoryOmitted = true

	out.Memory.SpeedMHz = nil
	out.Memory.SlotCount = nil
	out.Memory.FormFactor = ""
	out.Memory.MemoryType = ""

	for i := range out.CPUPackages {
		out.CPUPackages[i].Model = ""
		out.CPUPackages[i].CoreCount = 0
		out.CPUPackages[i].LogicalCount = 0
		out.CPUPackages[i].L3CacheBytes = 0
		out.CPUPackages[i].L2CacheBytes = 0
	}
	for i := range out.Disks {
		out.Disks[i].FileSystem = ""
		out.Disks[i].Model = ""
		out.Disks[i].Vendor = ""
		out.Disks[i].SourceKey = ""
		out.Disks[i].PhysicalDevice = ""
		out.Disks[i].HealthReason = ""
		out.Disks[i].SmartAttributes = nil
		out.Disks[i].InterfaceType = ""
	}
	for i := range out.NetworkIfaces {
		out.NetworkIfaces[i].Model = ""
		out.NetworkIfaces[i].MacAddress = ""
		out.NetworkIfaces[i].IPv4 = nil
		out.NetworkIfaces[i].IPv6 = nil
		out.NetworkIfaces[i].LinkSpeedMbps = nil
		out.NetworkIfaces[i].ConnectionType = ""
	}
	for i := range out.GPUs {
		out.GPUs[i].DriverVersion = ""
	}
	out.SensorBackends = nil
	return out
}

type binaryHasher struct {
	h   io.Writer
	buf [8]byte
}

func (b *binaryHasher) str(v string) {
	binary.LittleEndian.PutUint32(b.buf[:4], uint32(len(v)))
	_, _ = b.h.Write(b.buf[:4])
	if len(v) > 0 {
		_, _ = io.WriteString(b.h, v)
	}
}

func (b *binaryHasher) u64(v uint64) {
	binary.LittleEndian.PutUint64(b.buf[:8], v)
	_, _ = b.h.Write(b.buf[:8])
}

func (b *binaryHasher) i64(v int64) {
	b.u64(uint64(v))
}

func (b *binaryHasher) f64(v float64) {
	b.u64(math.Float64bits(v))
}

func (b *binaryHasher) optF64(v *float64) {
	if v == nil {
		b.buf[0] = 0
		_, _ = b.h.Write(b.buf[:1])
		return
	}
	b.buf[0] = 1
	_, _ = b.h.Write(b.buf[:1])
	b.f64(*v)
}

func (b *binaryHasher) optU64(v *uint64) {
	if v == nil {
		b.buf[0] = 0
		_, _ = b.h.Write(b.buf[:1])
		return
	}
	b.buf[0] = 1
	_, _ = b.h.Write(b.buf[:1])
	b.u64(*v)
}

func (b *binaryHasher) optInt(v *int) {
	if v == nil {
		b.buf[0] = 0
		_, _ = b.h.Write(b.buf[:1])
		return
	}
	b.buf[0] = 1
	_, _ = b.h.Write(b.buf[:1])
	b.i64(int64(*v))
}

func (b *binaryHasher) optBool(v *bool) {
	if v == nil {
		b.buf[0] = 0
		_, _ = b.h.Write(b.buf[:1])
		return
	}
	if *v {
		b.buf[0] = 2
	} else {
		b.buf[0] = 1
	}
	_, _ = b.h.Write(b.buf[:1])
}

func (b *binaryHasher) boolean(v bool) {
	if v {
		b.buf[0] = 1
	} else {
		b.buf[0] = 0
	}
	_, _ = b.h.Write(b.buf[:1])
}

func computeInventoryHash(payload metricsPayload) string {
	sum := sha256.New()
	bh := binaryHasher{h: sum}
	bh.str("inv:v1")
	bh.str(payload.Identity.DeviceID)
	bh.optF64(payload.Memory.SpeedMHz)
	bh.optInt(payload.Memory.SlotCount)
	bh.str(payload.Memory.FormFactor)
	bh.str(payload.Memory.MemoryType)

	bh.i64(int64(len(payload.CPUPackages)))
	for _, pkg := range payload.CPUPackages {
		bh.str(pkg.ID)
		bh.str(pkg.Name)
		bh.i64(int64(pkg.SocketIndex))
		bh.str(pkg.Model)
		bh.i64(int64(pkg.CoreCount))
		bh.i64(int64(pkg.LogicalCount))
		bh.u64(pkg.L3CacheBytes)
		bh.u64(pkg.L2CacheBytes)
	}

	bh.i64(int64(len(payload.Disks)))
	for _, d := range payload.Disks {
		bh.str(d.ID)
		bh.str(d.Name)
		bh.str(d.MountPoint)
		bh.str(d.FileSystem)
		bh.str(d.Model)
		bh.str(d.Vendor)
		bh.str(d.SourceKey)
		bh.str(d.PhysicalDevice)
		bh.str(d.HealthReason)
		bh.str(d.InterfaceType)
		bh.i64(int64(len(d.SmartAttributes)))
		for _, attr := range d.SmartAttributes {
			bh.i64(int64(attr.ID))
			bh.str(attr.Name)
			bh.f64(attr.Value)
			bh.f64(attr.Threshold)
		}
	}

	bh.i64(int64(len(payload.NetworkIfaces)))
	for _, nic := range payload.NetworkIfaces {
		bh.str(nic.ID)
		bh.str(nic.Name)
		bh.str(nic.Model)
		bh.str(nic.MacAddress)
		bh.i64(int64(len(nic.IPv4)))
		for _, ip := range nic.IPv4 {
			bh.str(ip)
		}
		bh.i64(int64(len(nic.IPv6)))
		for _, ip := range nic.IPv6 {
			bh.str(ip)
		}
		bh.optF64(nic.LinkSpeedMbps)
		bh.str(nic.ConnectionType)
	}

	bh.i64(int64(len(payload.GPUs)))
	for _, g := range payload.GPUs {
		bh.str(g.ID)
		bh.str(g.Name)
		bh.boolean(g.Integrated)
		bh.str(g.MemoryKind)
		bh.u64(g.MemoryTotalBytes)
		bh.str(g.DriverVersion)
	}

	bh.i64(int64(len(payload.SensorBackends)))
	for _, sb := range payload.SensorBackends {
		bh.str(sb.ID)
		bh.str(sb.Label)
		bh.boolean(sb.OK)
		bh.str(sb.Detail)
	}

	var digest [32]byte
	return hex.EncodeToString(sum.Sum(digest[:0]))
}

func computeSampleID(payload metricsPayload) string {
	sum := sha256.New()
	bh := binaryHasher{h: sum}
	bh.str("sample:v2")
	bh.str(payload.Identity.DeviceID)
	bh.str(payload.Identity.Hostname)
	bh.str(payload.Identity.OS)
	bh.str(payload.Identity.Platform)
	bh.str(payload.Identity.Arch)
	bh.str(payload.Identity.CPUModel)
	bh.str(payload.Identity.Version)
	bh.str(payload.Identity.Channel)
	bh.str(payload.Timestamp)
	bh.str(payload.HeartbeatAt)
	bh.str(payload.HardwareSampledAt)
	bh.str(payload.CPUTemperatureSampledAt)
	bh.i64(int64(payload.System.ProcessCount))
	bh.i64(int64(payload.System.ThreadCount))
	bh.u64(payload.System.HandleCount)
	bh.u64(payload.System.UptimeSeconds)
	bh.f64(payload.CPUUsagePercent)
	bh.optF64(payload.CPUFrequencyMHz)
	bh.optF64(payload.CPUTemperatureC)
	bh.u64(payload.Memory.TotalBytes)
	bh.u64(payload.Memory.UsedBytes)
	bh.u64(payload.Memory.AvailableBytes)
	bh.u64(payload.Memory.CachedBytes)
	bh.u64(payload.Memory.CommittedBytes)
	bh.u64(payload.Memory.CommitLimitBytes)
	bh.u64(payload.Memory.SwapTotalBytes)
	bh.u64(payload.Memory.SwapUsedBytes)
	bh.u64(payload.Memory.CompressedBytes)
	bh.str(payload.Memory.PressureLevel)
	bh.u64(payload.DiskUsage.TotalBytes)
	bh.u64(payload.DiskUsage.UsedBytes)
	bh.f64(payload.DiskRate.ReadBytesPerSec)
	bh.f64(payload.DiskRate.WriteBytesPerSec)
	bh.f64(payload.NetworkRate.RxBytesPerSec)
	bh.f64(payload.NetworkRate.TxBytesPerSec)
	bh.u64(payload.NetworkRate.TotalRxBytes)
	bh.u64(payload.NetworkRate.TotalTxBytes)
	bh.i64(int64(len(payload.Disks)))
	for _, d := range payload.Disks {
		bh.str(d.ID)
		bh.u64(d.TotalBytes)
		bh.u64(d.UsedBytes)
		bh.optF64(d.TemperatureC)
	}
	bh.i64(int64(len(payload.GPUs)))
	for _, g := range payload.GPUs {
		bh.str(g.ID)
		bh.f64(g.UtilizationPercent)
		bh.u64(g.MemoryUsedBytes)
		bh.optF64(g.TemperatureC)
	}
	bh.i64(int64(len(payload.Fans)))
	for _, f := range payload.Fans {
		bh.str(f.ID)
		bh.i64(int64(f.RPM))
	}
	bh.i64(int64(len(payload.TemperatureSensors)))
	for _, s := range payload.TemperatureSensors {
		bh.str(s.ID)
		bh.optF64(s.CurrentC)
	}
	var digest [32]byte
	return hex.EncodeToString(sum.Sum(digest[:0]))
}

func cloneInt(v *int) *int {
	if v == nil {
		return nil
	}
	c := *v
	return &c
}

func cloneUint64(v *uint64) *uint64 {
	if v == nil {
		return nil
	}
	c := *v
	return &c
}

func cloneBool(v *bool) *bool {
	if v == nil {
		return nil
	}
	c := *v
	return &c
}

func cloneStringSlice(items []string) []string {
	if items == nil {
		return nil
	}
	out := make([]string, len(items))
	copy(out, items)
	return out
}

func cloneRuntimeConfig(cfg agentRuntimeConfig) agentRuntimeConfig {
	out := cfg
	out.EnabledMetrics = cloneStringSlice(cfg.EnabledMetrics)
	if cfg.EnabledDeviceIDs != nil {
		out.EnabledDeviceIDs = make(map[string][]string, len(cfg.EnabledDeviceIDs))
		for k, v := range cfg.EnabledDeviceIDs {
			out.EnabledDeviceIDs[k] = cloneStringSlice(v)
		}
	}
	if cfg.InstanceMetricConfig != nil {
		out.InstanceMetricConfig = make(map[string][]string, len(cfg.InstanceMetricConfig))
		for k, v := range cfg.InstanceMetricConfig {
			out.InstanceMetricConfig[k] = cloneStringSlice(v)
		}
	}
	if cfg.ProbeSelections != nil {
		out.ProbeSelections = append([]agentProbeSelection(nil), cfg.ProbeSelections...)
	}
	return out
}

func cloneRateStats(rate rateStats) rateStats {
	out := rate
	if rate.Instances != nil {
		out.Instances = make(map[string]rateStats, len(rate.Instances))
		for k, v := range rate.Instances {
			out.Instances[k] = cloneRateStats(v)
		}
	}
	return out
}

func cloneMetricsPayload(payload metricsPayload) metricsPayload {
	out := payload
	out.CPUFrequencyMHz = cloneFloat64(payload.CPUFrequencyMHz)
	out.CPUTemperatureC = cloneFloat64(payload.CPUTemperatureC)
	out.Memory.SpeedMHz = cloneFloat64(payload.Memory.SpeedMHz)
	out.Memory.SlotCount = cloneInt(payload.Memory.SlotCount)
	out.DiskRate = cloneRateStats(payload.DiskRate)
	out.NetworkRate.Instances = nil

	if payload.CPUPackages != nil {
		out.CPUPackages = make([]cpuPackageStats, len(payload.CPUPackages))
		for i, pkg := range payload.CPUPackages {
			pkgCopy := pkg
			pkgCopy.FrequencyMHz = cloneFloat64(pkg.FrequencyMHz)
			pkgCopy.UsagePercent = cloneFloat64(pkg.UsagePercent)
			pkgCopy.TemperatureC = cloneFloat64(pkg.TemperatureC)
			if pkg.Clusters != nil {
				pkgCopy.Clusters = make([]cpuClusterStats, len(pkg.Clusters))
				for j, cl := range pkg.Clusters {
					clCopy := cl
					clCopy.FrequencyMHz = cloneFloat64(cl.FrequencyMHz)
					pkgCopy.Clusters[j] = clCopy
				}
			}
			out.CPUPackages[i] = pkgCopy
		}
	}

	if payload.Disks != nil {
		out.Disks = make([]diskDeviceStats, len(payload.Disks))
		for i, d := range payload.Disks {
			dCopy := d
			dCopy.TemperatureC = cloneFloat64(d.TemperatureC)
			dCopy.HealthPercent = cloneFloat64(d.HealthPercent)
			dCopy.ActivePercent = cloneFloat64(d.ActivePercent)
			dCopy.AverageResponseMs = cloneFloat64(d.AverageResponseMs)
			if d.SmartAttributes != nil {
				dCopy.SmartAttributes = append([]diskSmartAttribute(nil), d.SmartAttributes...)
			}
			out.Disks[i] = dCopy
		}
	}

	if payload.StoragePools != nil {
		out.StoragePools = make([]storagePoolStats, len(payload.StoragePools))
		for i, sp := range payload.StoragePools {
			spCopy := sp
			spCopy.PhysicalDevices = cloneStringSlice(sp.PhysicalDevices)
			spCopy.Content = cloneStringSlice(sp.Content)
			spCopy.Active = cloneBool(sp.Active)
			spCopy.Enabled = cloneBool(sp.Enabled)
			spCopy.Shared = cloneBool(sp.Shared)
			spCopy.AvailableBytes = cloneUint64(sp.AvailableBytes)
			spCopy.DataPercent = cloneFloat64(sp.DataPercent)
			spCopy.MetadataPercent = cloneFloat64(sp.MetadataPercent)
			out.StoragePools[i] = spCopy
		}
	}

	if payload.NetworkIfaces != nil {
		out.NetworkIfaces = make([]networkInterfaceStats, len(payload.NetworkIfaces))
		for i, nic := range payload.NetworkIfaces {
			nicCopy := nic
			nicCopy.IPv4 = cloneStringSlice(nic.IPv4)
			nicCopy.IPv6 = cloneStringSlice(nic.IPv6)
			nicCopy.LinkSpeedMbps = cloneFloat64(nic.LinkSpeedMbps)
			nicCopy.SignalStrengthPercent = cloneFloat64(nic.SignalStrengthPercent)
			nicCopy.RSSIdBm = cloneFloat64(nic.RSSIdBm)
			nicCopy.NoiseDbm = cloneFloat64(nic.NoiseDbm)
			out.NetworkIfaces[i] = nicCopy
		}
	}

	if payload.GPUs != nil {
		out.GPUs = make([]gpuDeviceStats, len(payload.GPUs))
		for i, g := range payload.GPUs {
			gCopy := g
			gCopy.EncodeUtilizationPercent = cloneFloat64(g.EncodeUtilizationPercent)
			gCopy.DecodeUtilizationPercent = cloneFloat64(g.DecodeUtilizationPercent)
			gCopy.FrequencyMHz = cloneFloat64(g.FrequencyMHz)
			gCopy.TemperatureC = cloneFloat64(g.TemperatureC)
			gCopy.utilizationObserved = false
			gCopy.memoryObserved = false
			out.GPUs[i] = gCopy
		}
	}

	if payload.Fans != nil {
		out.Fans = make([]fanSensorStats, len(payload.Fans))
		for i, f := range payload.Fans {
			fCopy := f
			fCopy.TargetTemperatureC = cloneFloat64(f.TargetTemperatureC)
			fCopy.MinPWMPercent = cloneFloat64(f.MinPWMPercent)
			fCopy.MaxPWMPercent = cloneFloat64(f.MaxPWMPercent)
			out.Fans[i] = fCopy
		}
	}

	if payload.TemperatureSensors != nil {
		out.TemperatureSensors = make([]temperatureSensorReading, len(payload.TemperatureSensors))
		for i, ts := range payload.TemperatureSensors {
			tsCopy := ts
			tsCopy.CurrentC = cloneFloat64(ts.CurrentC)
			tsCopy.HighC = cloneFloat64(ts.HighC)
			tsCopy.CriticalC = cloneFloat64(ts.CriticalC)
			tsCopy.EmergencyC = cloneFloat64(ts.EmergencyC)
			tsCopy.Alarm = cloneBool(ts.Alarm)
			out.TemperatureSensors[i] = tsCopy
		}
	}

	if payload.SensorBackends != nil {
		out.SensorBackends = append([]sensorBackendStatus(nil), payload.SensorBackends...)
	}
	out.UnavailableMetrics = cloneStringSlice(payload.UnavailableMetrics)
	if payload.MetricQuality != nil {
		out.MetricQuality = make(map[string]metricQuality, len(payload.MetricQuality))
		for k, v := range payload.MetricQuality {
			out.MetricQuality[k] = v
		}
	}
	if payload.ProbeSpawns != nil {
		out.ProbeSpawns = make(map[string]int, len(payload.ProbeSpawns))
		for k, v := range payload.ProbeSpawns {
			out.ProbeSpawns[k] = v
		}
	}
	if payload.CollectorStats != nil {
		statsCopy := *payload.CollectorStats
		out.CollectorStats = &statsCopy
	}
	if payload.Power != nil {
		pCopy := *payload.Power
		pCopy.SystemWatts = cloneFloat64(payload.Power.SystemWatts)
		pCopy.InputWatts = cloneFloat64(payload.Power.InputWatts)
		pCopy.CPUWatts = cloneFloat64(payload.Power.CPUWatts)
		pCopy.GPUWatts = cloneFloat64(payload.Power.GPUWatts)
		pCopy.ANEWatts = cloneFloat64(payload.Power.ANEWatts)
		pCopy.DRAMWatts = cloneFloat64(payload.Power.DRAMWatts)
		pCopy.MediaWatts = cloneFloat64(payload.Power.MediaWatts)
		pCopy.AdapterRatedWatts = cloneFloat64(payload.Power.AdapterRatedWatts)
		pCopy.ExternalPower = cloneBool(payload.Power.ExternalPower)
		out.Power = &pCopy
	}
	if payload.Battery != nil {
		bCopy := *payload.Battery
		bCopy.ChargePercent = cloneFloat64(payload.Battery.ChargePercent)
		bCopy.HealthPercent = cloneFloat64(payload.Battery.HealthPercent)
		bCopy.CycleCount = cloneInt(payload.Battery.CycleCount)
		bCopy.DesignCapacityMAh = cloneFloat64(payload.Battery.DesignCapacityMAh)
		bCopy.FullChargeCapacityMAh = cloneFloat64(payload.Battery.FullChargeCapacityMAh)
		bCopy.TemperatureC = cloneFloat64(payload.Battery.TemperatureC)
		bCopy.VoltageV = cloneFloat64(payload.Battery.VoltageV)
		bCopy.AmperageMA = cloneFloat64(payload.Battery.AmperageMA)
		bCopy.NetPowerWatts = cloneFloat64(payload.Battery.NetPowerWatts)
		bCopy.TimeRemainingMinutes = cloneFloat64(payload.Battery.TimeRemainingMinutes)
		bCopy.Charging = cloneBool(payload.Battery.Charging)
		bCopy.ExternalPower = cloneBool(payload.Battery.ExternalPower)
		bCopy.FullyCharged = cloneBool(payload.Battery.FullyCharged)
		out.Battery = &bCopy
	}
	if payload.Thermal != nil {
		tCopy := *payload.Thermal
		out.Thermal = &tCopy
	}
	return out
}

// Cached CPU topology avoids an expensive Win32_Processor WMI query on Windows
// and duplicate /proc/cpuinfo + sysfs globbing on Linux during every 30s fast sample.
var (
	cpuTopologyMu    sync.Mutex
	cpuTopologyInfo  []cpu.InfoStat
	cpuTopologyMap   map[int]string
	cpuTopologyAt    time.Time
)

func cachedCPUTopology(ctx context.Context) ([]cpu.InfoStat, map[int]string, error) {
	cpuTopologyMu.Lock()
	if len(cpuTopologyInfo) > 0 && time.Since(cpuTopologyAt) < cpuTopologyCacheRefreshEvery {
		info := cpuTopologyInfo
		pkgMap := cpuTopologyMap
		cpuTopologyMu.Unlock()
		return info, pkgMap, nil
	}
	cpuTopologyMu.Unlock()

	info, err := cpu.InfoWithContext(ctx)
	if err != nil {
		return nil, nil, err
	}
	if len(info) == 0 {
		return nil, nil, fmt.Errorf("no per-CPU topology reported")
	}
	pkgMap := cpuPackageIDs(info)

	cpuTopologyMu.Lock()
	cpuTopologyInfo = info
	cpuTopologyMap = pkgMap
	cpuTopologyAt = time.Now()
	cpuTopologyMu.Unlock()
	return info, pkgMap, nil
}

// EmbeddedOptions configures an in-process collector run inside guanlan-agent.
type EmbeddedOptions struct {
	ConfigPath     string
	BundleRoot     string
	PendingPath    string
	ServiceManaged bool
	Wake           <-chan struct{}
	OnUploaded     func(uploadedAt time.Time)
	OnLogLine      func(line string)
}

// HardwareSensorProbeResponse matches the JSON schema returned by hardware-sensor-probe.
type HardwareSensorProbeResponse struct {
	TemperatureSensors []temperatureSensorReading `json:"temperatureSources"`
	SensorBackends     []sensorBackendStatus      `json:"temperatureSensorBackends"`
	Fans               []fanSensorStats           `json:"fans"`
}

// ProbeHardwareSensors executes a one-shot hardware sensor discovery in-process.
func ProbeHardwareSensors() HardwareSensorProbeResponse {
	metrics, _ := collectSlowMetrics(
		hardwareAssetCache{},
		collectionPlan{systemStats: true, linuxCPUFast: true, gpu: true, diskSensors: true},
	)
	return HardwareSensorProbeResponse{
		TemperatureSensors: metrics.temperatureSensors,
		SensorBackends:     metrics.sensorBackends,
		Fans:               metrics.fans,
	}
}

// CleanupLegacyHardwareSensorTask removes any legacy DeviceStateConsoleHardwareSensors
// scheduled task when running in Windows service mode, where GuanlanAgent itself
// already runs as LocalSystem.
func CleanupLegacyHardwareSensorTask() {
	if runtime.GOOS != "windows" {
		return
	}
	_ = uninstallHardwareSensorHelper()
}

var (
	collectorLogObserverMu sync.RWMutex
	collectorLogObserver   func(string)
)

func setCollectorLogObserver(fn func(string)) {
	collectorLogObserverMu.Lock()
	collectorLogObserver = fn
	collectorLogObserverMu.Unlock()
}

func emitCollectorLog(line string) {
	log.Print(line)
	collectorLogObserverMu.RLock()
	observer := collectorLogObserver
	collectorLogObserverMu.RUnlock()
	if observer != nil {
		observer(line)
	}
}

func emitCollectorLogf(format string, args ...any) {
	emitCollectorLog(fmt.Sprintf(format, args...))
}

// RunEmbedded runs the collector upload and live-session loop in-process until ctx is canceled.
func RunEmbedded(ctx context.Context, opts EmbeddedOptions) error {
	ApplyHeadlessMemoryTuning()
	if opts.ServiceManaged {
		lowerCurrentProcessPriority()
	}
	if strings.TrimSpace(opts.BundleRoot) != "" {
		SetBundleRoot(opts.BundleRoot)
	}
	setCollectorLogObserver(opts.OnLogLine)
	defer setCollectorLogObserver(nil)
	defer closeWindowsHardwareWorker()

	defaultConnection := agentConnectionConfig{
		ServerURL: env("DSC_SERVER_URL", "http://127.0.0.1:38472"),
		Secret:    env("DSC_AGENT_SECRET", "replace-me-agent-secret"),
		DeviceID:  env("DSC_DEVICE_ID", ""),
		Hostname:  env("DSC_HOSTNAME", ""),
	}
	if defaultConnection.DeviceID == "" {
		name, _ := os.Hostname()
		defaultConnection.DeviceID = name
	}

	baseIdentity, err := buildIdentity(defaultConnection.DeviceID, defaultConnection.Hostname)
	if err != nil {
		return fmt.Errorf("build identity: %w", err)
	}

	configPath := strings.TrimSpace(opts.ConfigPath)
	if configPath == "" {
		configPath = env("DSC_AGENT_CONFIG_FILE", "")
	}

	state := &agentState{
		asyncSlow:    true,
		baseIdentity: baseIdentity,
		configPath:   configPath,
		client:       newAgentHTTPClient(),
		hubSession:   newHubSessionState(),
	}
	pending := newPendingStoreWithExplicitPath(state.configPath, opts.PendingPath)
	defer pending.close()

	defaultConfig := newDefaultRuntimeConfig(defaultConnection)
	var stateMu sync.Mutex
	startLiveClient(ctx, state, &stateMu, defaultConfig, filepath.Dir(pending.path))
	emitCollectorLogf("go agent v%s started for %s -> %s", BuildVersion, baseIdentity.DeviceID, defaultConnection.ServerURL)

	for {
		cycleStartedAt := time.Now()
		stateMu.Lock()
		cfg := state.loadRuntimeConfig(defaultConfig)
		stateMu.Unlock()

		interval := time.Duration(cfg.currentUploadIntervalSeconds()) * time.Second
		if !cfg.DataRecordingEnabled {
			emitCollectorLog("data recording is disabled; collector remains unregistered")
			if !waitForNextCycleOrWake(ctx.Done(), opts.Wake, interval, state, &stateMu) {
				return nil
			}
			continue
		}
		if !cfg.CloudSyncEnabled {
			emitCollectorLog("cloud sync is disabled; collector upload loop is paused")
			if !waitForNextCycleOrWake(ctx.Done(), opts.Wake, interval, state, &stateMu) {
				return nil
			}
			continue
		}

		stateMu.Lock()
		payload, sampleErr := freezeMetricsPayload(state.collectPayload(cfg))
		stateMu.Unlock()
		if sampleErr != nil {
			logCategoryf(logCategoryUpload, "sample serialization failed; skipping invalid sample")
			if !waitForNextCycleOrWake(ctx.Done(), opts.Wake, interval, state, &stateMu) {
				return nil
			}
			continue
		}
		if err := pending.drain(ctx, state.client, cfg.Connection.ServerURL, cfg.Connection.Secret); err != nil {
			logCategoryf(logCategoryUpload, "pending upload drain stopped: %v", err)
		}
		if err := postMetricsWithSession(ctx, state.client, state.hubSession, cfg.Connection.ServerURL, cfg.Connection.Secret, payload); err != nil {
			pending.lastUploadErr = err.Error()
			if enqueueErr := pending.enqueue(pendingSample{
				ID:        payload.SampleID,
				ServerURL: cfg.Connection.ServerURL,
				SampledAt: payload.Timestamp,
				Payload:   payload,
			}); enqueueErr != nil {
				logCategoryf(logCategoryUpload, "upload failed and pending spool write failed: %v", enqueueErr)
			} else {
				logCategoryf(logCategoryUpload, "upload failed; sample persisted for replay: %v", err)
			}
		} else {
			pending.recordHealthyUpload()
			uploadedAt := time.Now().UTC()
			if parsed, parseErr := time.Parse(time.RFC3339Nano, payload.Timestamp); parseErr == nil {
				uploadedAt = parsed
			} else if parsed, parseErr := time.Parse(time.RFC3339, payload.Timestamp); parseErr == nil {
				uploadedAt = parsed
			}
			if opts.OnUploaded != nil {
				opts.OnUploaded(uploadedAt)
			}
			emitCollectorLogf("uploaded metrics at %s", payload.Timestamp)
		}

		nextCycleAt := cycleStartedAt.Add(interval)
		if sleepDuration := time.Until(nextCycleAt); sleepDuration > 0 && !waitForNextCycleOrWake(ctx.Done(), opts.Wake, sleepDuration, state, &stateMu) {
			return nil
		}
	}
}

func waitForNextCycleOrWake(stop <-chan struct{}, wake <-chan struct{}, duration time.Duration, state *agentState, stateMu *sync.Mutex) bool {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-timer.C:
		return true
	case <-wake:
		if state != nil && stateMu != nil {
			stateMu.Lock()
			state.config.invalidate()
			stateMu.Unlock()
		}
		return true
	case <-stop:
		emitCollectorLog("shutdown requested; stopping new samples")
		return false
	}
}

func postMetricsWithSession(
	ctx context.Context,
	client *http.Client,
	session *hubSessionState,
	serverURL, secret string,
	payload metricsPayload,
) error {
	normalizedServerURL := strings.TrimRight(strings.TrimSpace(serverURL), "/")
	if err := validateServerTransport(normalizedServerURL); err != nil {
		return err
	}
	if client == nil {
		client = newAgentHTTPClient()
	}
	now := time.Now().UTC()
	payload = sanitizePendingPayload(payload)
	wirePayload, fullHash := session.prepareWirePayload(normalizedServerURL, payload, now)
	sentFull := !wirePayload.InventoryOmitted

	resp, err := sendIngestRequest(ctx, client, session, normalizedServerURL, secret, wirePayload)
	if err != nil {
		return err
	}
	if session.observeResponse(normalizedServerURL, payload.Identity.DeviceID, fullHash, sentFull, resp, now) {
		fullWire := payload
		fullWire.InventoryHash = fullHash
		fullWire.InventoryOmitted = false
		retryResp, retryErr := sendIngestRequest(ctx, client, session, normalizedServerURL, secret, fullWire)
		if retryErr != nil {
			return retryErr
		}
		session.observeResponse(normalizedServerURL, payload.Identity.DeviceID, fullHash, true, retryResp, time.Now().UTC())
	}
	return nil
}

func sendIngestRequest(
	ctx context.Context,
	client *http.Client,
	session *hubSessionState,
	normalizedServerURL, secret string,
	wirePayload metricsPayload,
) (hubIngestResponse, error) {
	rawBody, err := json.Marshal(wirePayload)
	if err != nil {
		return hubIngestResponse{}, err
	}

	useGzip := session != nil && session.useGzip(normalizedServerURL) && len(rawBody) >= minGzipPayloadBytes
	bodyToSend := rawBody
	if useGzip {
		if compressed, gzipErr := compressGzipPayload(rawBody); gzipErr == nil && len(compressed) < len(rawBody) {
			bodyToSend = compressed
		} else {
			useGzip = false
		}
	}

	resp, statusCode, statusText, err := doIngestHTTP(ctx, client, normalizedServerURL, secret, bodyToSend, useGzip)
	if err != nil {
		return hubIngestResponse{}, err
	}
	if useGzip && statusCode == http.StatusUnsupportedMediaType {
		session.disableGzip(normalizedServerURL)
		resp, statusCode, statusText, err = doIngestHTTP(ctx, client, normalizedServerURL, secret, rawBody, false)
		if err != nil {
			return hubIngestResponse{}, err
		}
	}
	if statusCode >= 300 {
		return hubIngestResponse{}, &httpStatusError{StatusCode: statusCode, Status: statusText}
	}
	return resp, nil
}

func doIngestHTTP(
	ctx context.Context,
	client *http.Client,
	normalizedServerURL, secret string,
	body []byte,
	compressed bool,
) (hubIngestResponse, int, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, fmt.Sprintf("%s/api/agent/ingest", normalizedServerURL), bytes.NewReader(body))
	if err != nil {
		return hubIngestResponse{}, 0, "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", secret))
	if compressed {
		req.Header.Set("Content-Encoding", "gzip")
	}

	response, err := client.Do(req)
	if err != nil {
		return hubIngestResponse{}, 0, "", err
	}
	defer response.Body.Close()

	respBytes, _ := io.ReadAll(io.LimitReader(response.Body, 8192))
	var parsed hubIngestResponse
	if response.StatusCode < 300 && len(bytes.TrimSpace(respBytes)) > 0 {
		_ = json.Unmarshal(respBytes, &parsed)
	}
	return parsed, response.StatusCode, response.Status, nil
}
