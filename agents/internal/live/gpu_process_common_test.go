package live

import (
	"context"
	"math"
	"testing"
)

func TestUnavailableGPUProviderDoesNotInventSamples(t *testing.T) {
	if samples := (unavailableGPUProcessSampler{}).sample(context.Background(), nil); samples != nil {
		t.Fatalf("unavailable provider returned samples: %#v", samples)
	}
	if _, ok := validGPUPercent(math.NaN()); ok {
		t.Fatal("NaN must remain unavailable")
	}
	if value, ok := validGPUPercent(125); !ok || value != 100 {
		t.Fatalf("GPU values must be bounded, got %v %v", value, ok)
	}
}
