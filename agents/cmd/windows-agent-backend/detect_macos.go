package main

import (
	"device-state-console/agent/internal/macos"
	"strings"
)

func detectDarwinDisks(enabled map[string]struct{}, explicit bool) []probeDetectedTarget {
	containers, err := macos.ReadAPFS()
	if err != nil {
		return []probeDetectedTarget{}
	}
	mounts, err := macos.ReadMounts()
	if err != nil {
		return []probeDetectedTarget{}
	}
	result := []probeDetectedTarget{}
	for _, container := range containers {
		id, name, mount := macos.APFSIdentity(container, mounts)
		if mount == "" {
			continue
		}
		result = append(result, probeDetectedTarget{ID: id, Name: name, Subtitle: mount + " · APFS container", Enabled: isIDEnabled(enabled, explicit, id)})
	}
	return result
}

func detectDarwinGPUs(enabled map[string]struct{}, explicit bool) ([]probeDetectedTarget, error) {
	hardware, err := macos.ReadHardware()
	if err != nil {
		return nil, err
	}
	result := []probeDetectedTarget{}
	for _, gpu := range hardware.GPUs {
		result = append(result, probeDetectedTarget{ID: gpu.ID, Name: gpu.Name, Subtitle: gpu.MemoryKind, Enabled: isIDEnabled(enabled, explicit, gpu.ID)})
	}
	return result, nil
}

func detectDarwinFans(cfg agentLocalConfig) []probeDetectedTarget {
	hardware, err := macos.ReadHardware()
	if err != nil {
		return []probeDetectedTarget{}
	}
	enabled, explicit := enabledIDs(cfg.EnabledDeviceIDs, "fan")
	result := []probeDetectedTarget{}
	for _, entry := range hardware.SMC {
		if len(entry.Key) != 4 || !strings.HasPrefix(entry.Key, "F") || !strings.HasSuffix(entry.Key, "Ac") {
			continue
		}
		if value, err := macos.DecodeSMC(entry.Type, entry.Data); err != nil || *value < 0 || *value > 30000 {
			continue
		}
		id := "smc-" + entry.Key[:2]
		result = append(result, probeDetectedTarget{ID: id, Name: "SMC " + entry.Key[:2], Subtitle: "AppleSMC (read-only)", Enabled: isIDEnabled(enabled, explicit, id)})
	}
	return result
}
