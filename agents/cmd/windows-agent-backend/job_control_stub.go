//go:build !windows

package main

type noopJobObject struct{}

func newPlatformJobObject() (jobObject, error) {
	return noopJobObject{}, nil
}

func (noopJobObject) Assign(int) error {
	return nil
}

func (noopJobObject) Close() error {
	return nil
}
