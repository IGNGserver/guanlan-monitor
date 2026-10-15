//go:build !windows

package live

import (
	"context"
	"errors"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func dockerTransport() (*http.Transport, error) {
	socket := "/var/run/docker.sock"
	if host := os.Getenv("DOCKER_HOST"); host != "" {
		if !strings.HasPrefix(host, "unix://") {
			return nil, errors.New("docker_unavailable")
		}
		socket = strings.TrimPrefix(host, "unix://")
	} else {
		var candidates []string
		if runtimeDir := os.Getenv("XDG_RUNTIME_DIR"); runtimeDir != "" {
			candidates = append(candidates, filepath.Join(runtimeDir, "docker.sock"))
		}
		if home, err := os.UserHomeDir(); err == nil {
			candidates = append(candidates, filepath.Join(home, ".docker", "run", "docker.sock"))
		}
		for _, candidate := range candidates {
			if _, err := os.Stat(candidate); err == nil {
				socket = candidate
				break
			}
		}
	}
	if !filepath.IsAbs(socket) {
		return nil, errors.New("docker_unavailable")
	}
	dialer := &net.Dialer{Timeout: time.Second}
	return &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return dialer.DialContext(ctx, "unix", socket)
	}, MaxConnsPerHost: 4, MaxIdleConnsPerHost: 4, ResponseHeaderTimeout: 2 * time.Second}, nil
}
