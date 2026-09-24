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
	performanceInfo, ok := readWindowsPerformanceInformation()
	if !ok {
		return systemStats{}, false
	}
	return systemStats{
		ProcessCount: int(performanceInfo.processCount),
		ThreadCount:  int(performanceInfo.threadCount),
		HandleCount:  uint64(performanceInfo.handleCount),
	}, true
}

func collectWindowsCommitMemory() (uint64, uint64, bool) {
	performanceInfo, ok := readWindowsPerformanceInformation()
	if !ok || performanceInfo.pageSize == 0 {
		return 0, 0, false
	}
	return performanceInfo.commitTotal * performanceInfo.pageSize,
		performanceInfo.commitLimit * performanceInfo.pageSize,
		true
}

func readWindowsPerformanceInformation() (windowsPerformanceInformation, bool) {
	performanceInfo := windowsPerformanceInformation{
		cb: uint32(unsafe.Sizeof(windowsPerformanceInformation{})),
	}
	result, _, _ := procGetPerformanceInfo.Call(
		uintptr(unsafe.Pointer(&performanceInfo)),
		uintptr(performanceInfo.cb),
	)
	return performanceInfo, result != 0
}
