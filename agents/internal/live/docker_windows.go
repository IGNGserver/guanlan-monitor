package live

import (
	"context"
	"errors"
	"github.com/Microsoft/go-winio"
	"net"
	"net/http"
	"os"
	"strings"
	"time"
)

func dockerTransport() (*http.Transport, error) {
	pipe := `\\.\pipe\docker_engine`
	if host := os.Getenv("DOCKER_HOST"); host != "" {
		if !strings.HasPrefix(host, "npipe:////./pipe/") {
			return nil, errors.New("docker_unavailable")
		}
		pipe = `\\.\pipe\` + strings.TrimPrefix(host, "npipe:////./pipe/")
	}
	return &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) { return winio.DialPipeContext(ctx, pipe) }, MaxConnsPerHost: 4, MaxIdleConnsPerHost: 4, ResponseHeaderTimeout: 2 * time.Second}, nil
}
