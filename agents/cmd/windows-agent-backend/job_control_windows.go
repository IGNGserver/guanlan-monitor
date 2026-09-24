//go:build windows

package main

import (
	"fmt"
	"unsafe"

	"golang.org/x/sys/windows"
)

type windowsJobObject struct {
	handle windows.Handle
}

func newPlatformJobObject() (jobObject, error) {
	handle, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return nil, err
	}

	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	info.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE

	if _, err := windows.SetInformationJobObject(
		handle,
		windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)),
		uint32(unsafe.Sizeof(info)),
	); err != nil {
		_ = windows.CloseHandle(handle)
		return nil, err
	}

	return &windowsJobObject{handle: handle}, nil
}

func (j *windowsJobObject) Assign(pid int) error {
	processHandle, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(pid))
	if err != nil {
		return err
	}
	defer windows.CloseHandle(processHandle)

	if err := windows.AssignProcessToJobObject(j.handle, processHandle); err != nil {
		return fmt.Errorf("assign process to job object: %w", err)
	}
	return nil
}

func (j *windowsJobObject) Close() error {
	return windows.CloseHandle(j.handle)
}
