package main

type parentProcessWatcher interface {
	Wait() error
	Close() error
}
