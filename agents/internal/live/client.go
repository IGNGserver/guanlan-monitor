// Package live implements bounded, read-only RPC. There is deliberately no offline request queue.
package live

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"device-state-console/agent/internal/agentconfig"
	"github.com/coder/websocket"
)

type Config struct {
	ServerURL string
	AccessKey string
	DeviceID  string
	Enabled   bool
}

type Identity struct {
	InstanceID string `json:"instanceId"`
	Token      string `json:"token"`
}

// Request is one live query. HubRevision is what the Hub announced in welcome:
// 1 (or absent) only accepts the original result shapes, so newer shapes are opt-in.
type Request struct {
	Topic       string
	HubRevision int
}
type Handler func(context.Context, Request) (any, error)
type Client struct {
	Config    func() Config
	Directory string
	Handle    Handler
	HTTP      *http.Client
	jobsMu    sync.Mutex
	busy      map[string]bool
}

type frame struct {
	Type            string `json:"type"`
	ProtocolVersion int    `json:"protocolVersion,omitempty"`
	Revision        int    `json:"revision,omitempty"`
	SessionID       string `json:"sessionId,omitempty"`
	RequestID       string `json:"requestId,omitempty"`
	Topic           string `json:"topic,omitempty"`
	Nonce           string `json:"nonce,omitempty"`
	TimeoutMs       int    `json:"timeoutMs,omitempty"`
}

func newIdentity() (Identity, error) {
	var uuid [16]byte
	var token [32]byte
	if _, err := rand.Read(uuid[:]); err != nil {
		return Identity{}, err
	}
	if _, err := rand.Read(token[:]); err != nil {
		return Identity{}, err
	}
	uuid[6] = (uuid[6] & 0x0f) | 0x40
	uuid[8] = (uuid[8] & 0x3f) | 0x80
	id := hex.EncodeToString(uuid[:])
	return Identity{InstanceID: id[:8] + "-" + id[8:12] + "-" + id[12:16] + "-" + id[16:20] + "-" + id[20:], Token: hex.EncodeToString(token[:])}, nil
}

func readIdentity(file string) (Identity, bool, error) {
	raw, err := agentconfig.ReadFileLimited(file)
	if os.IsNotExist(err) {
		return Identity{}, false, nil
	}
	if err != nil {
		return Identity{}, false, errors.New("realtime_identity_unreadable")
	}
	var id Identity
	if json.Unmarshal(raw, &id) != nil || len(id.InstanceID) != 36 || len(id.Token) != 64 {
		return Identity{}, false, errors.New("invalid_realtime_identity")
	}
	return id, true, nil
}

// identity is keyed by device only. Keying it by Hub URL too meant that merely
// re-typing the Hub address (http→https, a trailing slash, a new domain) made a
// new installation identity that the Hub then refused as a conflict, forever.
func (c *Client) identity(cfg Config) (Identity, error) {
	scope := sha256.Sum256([]byte(cfg.DeviceID))
	file := filepath.Join(c.Directory, "live-device-"+hex.EncodeToString(scope[:8])+".json")
	if id, ok, err := readIdentity(file); err != nil || ok {
		return id, err
	}
	// Adopt the identity an earlier version stored for this Hub URL + device.
	legacyScope := sha256.Sum256([]byte(cfg.ServerURL + "\x00" + cfg.DeviceID))
	id, ok, err := readIdentity(filepath.Join(c.Directory, "live-"+hex.EncodeToString(legacyScope[:8])+".json"))
	if err != nil {
		return Identity{}, err
	}
	if !ok {
		if id, err = newIdentity(); err != nil {
			return Identity{}, err
		}
	}
	raw, err := json.Marshal(id)
	if err != nil {
		return Identity{}, err
	}
	if err := agentconfig.WriteFileAtomic(file, raw, 0o600); err != nil {
		return Identity{}, errors.New("realtime_identity_write_failed")
	}
	return id, nil
}

func endpoint(base, suffix string) (string, error) {
	u, err := url.Parse(base)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", errors.New("invalid_realtime_hub_url")
	}
	u.Path = strings.TrimRight(u.Path, "/") + suffix
	u.RawPath = ""
	return u.String(), nil
}

func (c *Client) Run(ctx context.Context) {
	backoff := time.Second
	for ctx.Err() == nil {
		cfg := c.Config()
		if cfg.Enabled && cfg.AccessKey != "" {
			started := time.Now()
			if err := c.connect(ctx, cfg); err != nil && ctx.Err() == nil {
				log.Printf("realtime channel unavailable: %v", err)
			}
			if time.Since(started) > time.Minute {
				backoff = time.Second
			}
		}
		timer := time.NewTimer(backoff)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
		if backoff < 30*time.Second {
			backoff *= 2
		}
		if backoff > 30*time.Second {
			backoff = 30 * time.Second
		}
	}
}

func (c *Client) connect(ctx context.Context, cfg Config) error {
	enrollURL, err := endpoint(cfg.ServerURL, "/api/agent/enroll")
	if err != nil {
		return err
	}
	id, err := c.identity(cfg)
	if err != nil {
		return err
	}
	body, _ := json.Marshal(map[string]string{"deviceId": cfg.DeviceID, "instanceId": id.InstanceID, "token": id.Token})
	enrollCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(enrollCtx, http.MethodPost, enrollURL, bytes.NewReader(body))
	if err != nil {
		return errors.New("realtime_enrollment_failed")
	}
	req.Header.Set("Authorization", "Bearer "+cfg.AccessKey)
	req.Header.Set("Content-Type", "application/json")
	client := c.HTTP
	if client == nil {
		client = &http.Client{Timeout: 8 * time.Second}
	}
	// Credentials must never be forwarded to a redirect target.
	noRedirect := *client
	noRedirect.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
	response, err := noRedirect.Do(req)
	if err != nil {
		return errors.New("realtime_enrollment_unreachable")
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
	response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("realtime_enrollment_http_%d", response.StatusCode)
	}
	wsURL, _ := endpoint(cfg.ServerURL, "/api/agent/realtime")
	u, _ := url.Parse(wsURL)
	if u.Scheme == "https" {
		u.Scheme = "wss"
	} else {
		u.Scheme = "ws"
	}
	dialCtx, dialCancel := context.WithTimeout(ctx, 8*time.Second)
	// Process and container lists compress well; this matters on slow uplinks
	// where an uncompressed list could exceed the write deadline.
	conn, _, err := websocket.Dial(dialCtx, u.String(), &websocket.DialOptions{HTTPClient: &noRedirect, HTTPHeader: http.Header{"Authorization": []string{"Bearer " + id.Token}, "X-Device-Id": []string{cfg.DeviceID}, "X-Instance-Id": []string{id.InstanceID}}, CompressionMode: websocket.CompressionNoContextTakeover, CompressionThreshold: 4096})
	dialCancel()
	if err != nil {
		return errors.New("realtime_connect_failed")
	}
	defer conn.CloseNow()
	conn.SetReadLimit(16 * 1024)
	sessionCtx, stop := context.WithCancel(ctx)
	defer stop()
	var writeMu sync.Mutex
	write := func(value any) error {
		raw, err := json.Marshal(value)
		if err != nil || len(raw) > 4*1024*1024 {
			return errors.New("realtime_response_too_large")
		}
		writeMu.Lock()
		defer writeMu.Unlock()
		writeCtx, done := context.WithTimeout(sessionCtx, writeTimeout(len(raw)))
		defer done()
		return conn.Write(writeCtx, websocket.MessageText, raw)
	}
	if err := write(map[string]any{"type": "hello", "protocolVersion": 1, "capabilities": []string{"metrics", "processes", "docker"}}); err != nil {
		return err
	}
	var sessionID string
	hubRevision := 1
	for {
		readCtx, readCancel := context.WithTimeout(sessionCtx, 20*time.Second)
		kind, raw, err := conn.Read(readCtx)
		readCancel()
		if err != nil {
			return errors.New("realtime_disconnected")
		}
		var message frame
		if kind != websocket.MessageText || json.Unmarshal(raw, &message) != nil {
			return errors.New("invalid_realtime_frame")
		}
		current := c.Config()
		if !current.Enabled || current.ServerURL != cfg.ServerURL || current.DeviceID != cfg.DeviceID || current.AccessKey != cfg.AccessKey {
			return errors.New("realtime_configuration_changed")
		}
		if message.Type == "welcome" && sessionID == "" && message.ProtocolVersion == 1 && len(message.SessionID) == 36 {
			sessionID = message.SessionID
			if message.Revision > 1 {
				hubRevision = message.Revision
			}
			if err := write(frame{Type: "ready", SessionID: sessionID}); err != nil {
				return err
			}
			continue
		}
		if sessionID == "" || message.SessionID != sessionID {
			return errors.New("invalid_realtime_session")
		}
		if message.Type == "ping" {
			if err := write(frame{Type: "pong", SessionID: sessionID, Nonce: message.Nonce}); err != nil {
				return err
			}
			continue
		}
		// Frame types from a newer Hub are not a protocol violation; ignoring them
		// keeps an older Agent connected instead of reconnecting in a loop.
		if message.Type != "request" {
			continue
		}
		if len(message.RequestID) != 36 {
			return errors.New("invalid_realtime_request")
		}
		// A well-addressed request this Agent cannot serve fails alone.
		if message.TimeoutMs <= 0 || message.TimeoutMs > 5000 || (message.Topic != "metrics" && message.Topic != "processes" && message.Topic != "docker") {
			if err := write(map[string]any{"type": "error", "sessionId": sessionID, "requestId": message.RequestID, "code": "collection_failed"}); err != nil {
				return err
			}
			continue
		}
		if err := write(frame{Type: "ack", SessionID: sessionID, RequestID: message.RequestID}); err != nil {
			return err
		}
		c.jobsMu.Lock()
		if c.busy == nil {
			c.busy = make(map[string]bool)
		}
		occupied := c.busy[message.Topic]
		if !occupied {
			c.busy[message.Topic] = true
		}
		c.jobsMu.Unlock()
		if occupied {
			if err := write(map[string]any{"type": "error", "sessionId": sessionID, "requestId": message.RequestID, "code": "collection_busy"}); err != nil {
				return err
			}
			continue
		}
		jobCtx, jobCancel := context.WithTimeout(sessionCtx, time.Duration(message.TimeoutMs)*time.Millisecond)
		go func(message frame, sid string, revision int) {
			defer func() { c.jobsMu.Lock(); delete(c.busy, message.Topic); c.jobsMu.Unlock() }()
			defer jobCancel()
			data, err := safeHandle(jobCtx, c.Handle, Request{Topic: message.Topic, HubRevision: revision})
			if sessionCtx.Err() != nil {
				return
			}
			if c.Config() != cfg {
				stop()
				_ = conn.CloseNow()
				return
			}
			if jobCtx.Err() != nil {
				err = jobCtx.Err()
			}
			var reply any = map[string]any{"type": "result", "sessionId": sid, "requestId": message.RequestID, "topic": message.Topic, "data": data}
			if err != nil {
				code := "collection_failed"
				for _, allowed := range []string{"collection_disabled", "docker_unavailable", "docker_permission_denied"} {
					if err.Error() == allowed {
						code = allowed
					}
				}
				if jobCtx.Err() != nil {
					code = "query_expired"
				}
				reply = map[string]any{"type": "error", "sessionId": sid, "requestId": message.RequestID, "code": code}
			}
			if err := write(reply); err != nil {
				stop()
				_ = conn.CloseNow()
			}
		}(message, sessionID, hubRevision)
	}
}

func safeHandle(ctx context.Context, handler Handler, request Request) (data any, err error) {
	defer func() {
		if recover() != nil {
			data = nil
			err = errors.New("collection_failed")
		}
	}()
	return handler(ctx, request)
}

// writeTimeout gives large results time to cross a slow uplink (about 64 KiB/s
// before compression) instead of failing the write and with it the session.
func writeTimeout(size int) time.Duration {
	timeout := 2*time.Second + time.Duration(size/(64*1024))*time.Second
	if timeout > 10*time.Second {
		timeout = 10 * time.Second
	}
	return timeout
}
