//go:build windows

package main

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

var procGetPerformanceInfo = windows.NewLazySystemDLL("psapi.dll").NewProc("GetPerformanceInfo")

type windowsPerformanceInformation struct {
	cb                uint32
	commitTotal       uint64
	commitLimit       uint64
	commitPeak        uint64
	physicalTotal     uint64
	physicalAvailable uint64
	systemCache       uint64
	kernelTotal       uint64
	kernelPaged       uint64
	kernelNonpaged    uint64
	pageSize          uint64
	handleCount       uint32
	processCount      uint32
	threadCount       uint32
}

func collectWindowsSystemStats() (systemStats, bool) {
	performanceInfo := windowsPerformanceInformation{
		cb: uint32(unsafe.Sizeof(windowsPerformanceInformation{})),
	}
	result, _, _ := procGetPerformanceInfo.Call(
		uintptr(unsafe.Pointer(&performanceInfo)),
		uintptr(performanceInfo.cb),
	)
	if result == 0 {
		return systemStats{}, false
	}
	return systemStats{
		ProcessCount: int(performanceInfo.processCount),
		ThreadCount:  int(performanceInfo.threadCount),
		HandleCount:  uint64(performanceInfo.handleCount),
	}, true
}
