//go:build !windows

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type procParentProcessWatcher struct {
	pid       int
	stop      chan struct{}
	done      chan error
	closeOnce sync.Once
}

func newParentProcessWatcher(pid int) (parentProcessWatcher, error) {
	if pid <= 0 {
		return nil, fmt.Errorf("invalid parent process id: %d", pid)
	}

	watcher := &procParentProcessWatcher{
		pid:  pid,
		stop: make(chan struct{}),
		done: make(chan error, 1),
	}
	go watcher.run()
	return watcher, nil
}

func (w *procParentProcessWatcher) run() {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-w.stop:
			w.done <- nil
			return
		case <-ticker.C:
			if _, err := os.Stat(filepath.Join("/proc", fmt.Sprintf("%d", w.pid))); err != nil {
				if os.IsNotExist(err) {
					w.done <- fmt.Errorf("parent process exited: pid=%d", w.pid)
				} else {
					w.done <- fmt.Errorf("parent process probe failed for pid=%d: %w", w.pid, err)
				}
				return
			}
		}
	}
}

func (w *procParentProcessWatcher) Wait() error {
	return <-w.done
}

func (w *procParentProcessWatcher) Close() error {
	w.closeOnce.Do(func() {
		close(w.stop)
	})
	return nil
}
