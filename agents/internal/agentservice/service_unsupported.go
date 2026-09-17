//go:build !windows && !linux

package agentservice

import (
	"context"
	"errors"
)

// Name returns the service identity used in messages and JSON output.
func Name() string { return "guanlan-agent" }

var errUnsupported = errors.New("the machine-scope agent service is only supported on Windows and Linux")

// Install is unavailable on this platform.
func Install(Spec) (Status, error) { return Status{Kind: KindNone}, errUnsupported }

// Uninstall is unavailable on this platform.
func Uninstall() (Status, error) { return Status{Kind: KindNone}, errUnsupported }

// Start is unavailable on this platform.
func Start() (Status, error) { return Status{Kind: KindNone}, errUnsupported }

// Stop is unavailable on this platform.
func Stop() (Status, error) { return Status{Kind: KindNone}, errUnsupported }

// Query always reports that no service is installed.
func Query() (Status, error) { return Status{Kind: KindNone, Installed: false, Running: false}, nil }

func runAsService(_ func(context.Context) error) (bool, error) { return false, nil }
