package main

type jobObject interface {
	Assign(pid int) error
	Close() error
}

func newJobObject() (jobObject, error) {
	return newPlatformJobObject()
}
