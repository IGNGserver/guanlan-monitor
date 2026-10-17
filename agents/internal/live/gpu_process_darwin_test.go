//go:build darwin

package live

import "testing"

func TestPowermetricsProcessGPUParsesMillisecondsPerSecond(t *testing.T) {
	key := processGPUKey{pid: 123, started: 456}
	result := parsePowermetricsProcessGPU(`
*** Running tasks ***
Name ID CPU ms/s User% Wakeups GPU ms/s
Safari 123 10.00 50.00 2.00 80.00
Other 456 1.00 20.00 0.00 0.00
`, map[int32]processGPUKey{123: key})
	if got := result[key]; got != 8 {
		t.Fatalf("GPU ms/s was not converted to percent: %v", got)
	}
}
