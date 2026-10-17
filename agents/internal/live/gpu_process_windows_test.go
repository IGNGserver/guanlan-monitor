//go:build windows

package live

import "testing"

func TestGPUEnginePIDParsesPDHInstanceNames(t *testing.T) {
	pid, ok := gpuEnginePID("pid_1234_luid_0x00000000_phys_0_eng_0_engtype_3D")
	if !ok || pid != 1234 {
		t.Fatalf("unexpected PDH PID: %d %v", pid, ok)
	}
	if _, ok := gpuEnginePID("luid_0x00000000_phys_0_eng_0"); ok {
		t.Fatal("accepted a GPU instance without a PID")
	}
}
