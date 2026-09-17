package main

import "device-state-console/agent/internal/agentconfig"

// writeStateFile keeps the historical call sites unchanged; the atomic replace
// implementation now lives in the shared configuration package.
func writeStateFile(path string, raw []byte) error {
	return agentconfig.WriteFileAtomic(path, raw, 0o600)
}
