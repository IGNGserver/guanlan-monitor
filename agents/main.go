package main

import (
	"os"

	"device-state-console/agent/internal/collector"
)

// BuildVersion is injected by release build scripts (-ldflags "-X main.BuildVersion=...").
var BuildVersion = "dev"

// BuildChannel is injected by release build scripts (-ldflags "-X main.BuildChannel=...").
var BuildChannel = "test"

func main() {
	collector.SetBuildInfo(BuildVersion, BuildChannel)
	collector.Main(os.Args)
}
