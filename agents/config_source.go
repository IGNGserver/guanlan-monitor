package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"log"
	"os"
	"sync"
	"time"
)

// configSource reads the agent config file and keeps the last good content
// while the file is unreadable, empty or half-written. The project's own writers
// replace it atomically, but hand edits, tools that rewrite in place, scanners
// holding a lock or a permission change can still fail one read; falling back
// to the built-in defaults for that read would post a sample to the default Hub
// with the placeholder secret, spool it under that URL, revert the sync and
// recording switches, and drop the live session as "configuration changed".
// Only a missing file means "use the defaults".
type configSource struct {
	mu      sync.Mutex
	path    string
	good    []byte // last content that parsed; nil while the file is absent
	have    bool   // a read has settled (good content or a confirmed absent file)
	modTime time.Time
	size    int64
	readAt  time.Time
	failing bool
}

// configRecheck bounds how long an unchanged stat result is trusted, in case a
// rewrite keeps both size and modification time.
const configRecheck = 30 * time.Second

func newConfigSource(path string) *configSource {
	return &configSource{path: path}
}

// load returns defaults merged with the last good file content. Every call
// decodes a fresh copy, so callers never share slices or maps.
func (s *configSource) load(defaults agentRuntimeConfig) agentRuntimeConfig {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.path == "" {
		return defaults
	}
	s.refresh()
	if s.good == nil {
		return defaults
	}
	var fileCfg agentConfigFile
	if json.Unmarshal(s.good, &fileCfg) != nil {
		return defaults
	}
	return mergeConfig(defaults, fileCfg)
}

func (s *configSource) refresh() {
	now := time.Now()
	info, err := os.Stat(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			s.good, s.have, s.readAt = nil, true, now
			s.recovered()
			return
		}
		s.fail(logCategoryConfigRead, err)
		return
	}
	if s.have && info.ModTime().Equal(s.modTime) && info.Size() == s.size && now.Sub(s.readAt) < configRecheck {
		return
	}
	raw, err := os.ReadFile(s.path)
	if err != nil {
		s.fail(logCategoryConfigRead, err)
		return
	}
	raw = trimUTF8BOM(raw)
	if len(bytes.TrimSpace(raw)) == 0 {
		s.fail(logCategoryConfigParse, errors.New("config file is empty"))
		return
	}
	var fileCfg agentConfigFile
	if err := json.Unmarshal(raw, &fileCfg); err != nil {
		s.fail(logCategoryConfigParse, err)
		return
	}
	s.good, s.have, s.modTime, s.size, s.readAt = raw, true, info.ModTime(), info.Size(), now
	s.recovered()
}

// fail keeps the previous content and the previous stat stamp, so the next call
// reads the file again. It logs only when the source starts failing.
func (s *configSource) fail(category string, err error) {
	if !s.failing {
		if s.have {
			logCategoryf(category, "agent config unreadable, keeping the last good configuration: %v", err)
		} else {
			logCategoryf(category, "agent config unreadable and no earlier configuration, using defaults: %v", err)
		}
	}
	s.failing = true
}

func (s *configSource) recovered() {
	if s.failing {
		log.Printf("agent config readable again")
	}
	s.failing = false
}
