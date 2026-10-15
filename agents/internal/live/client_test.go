package live

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

func TestIdentityPersistsAndEndpointRejectsEmbeddedCredentials(t *testing.T) {
	c := Client{Directory: t.TempDir()}
	cfg := Config{ServerURL: "https://hub.example", DeviceID: "node"}
	first, err := c.identity(cfg)
	if err != nil {
		t.Fatal(err)
	}
	second, err := c.identity(cfg)
	if err != nil || first != second {
		t.Fatal("identity changed across restart", err)
	}
	if _, err := endpoint("https://username:password@hub.example", "/api/agent/enroll"); err == nil {
		t.Fatal("embedded credentials accepted")
	}
	if _, err := endpoint("https://hub.example?token=hidden", "/api/agent/enroll"); err == nil {
		t.Fatal("URL query accepted")
	}
	files, _ := os.ReadDir(c.Directory)
	if len(files) != 1 {
		t.Fatal("identity not persisted")
	}
}

func TestClientAcknowledgesBeforeCollectingAndAnswersHeartbeatDuringCollection(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	started := make(chan struct{})
	release := make(chan struct{})
	verified := make(chan error, 1)
	const sid = "bfe51be2-7239-46d5-bcdc-c0752fa32a11"
	const rid = "e303572e-9e2c-44fc-a30c-13c19f306d90"
	var token atomic.Value
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/agent/enroll" {
			var input struct{ Token string }
			if json.NewDecoder(r.Body).Decode(&input) != nil {
				w.WriteHeader(400)
				return
			}
			token.Store(input.Token)
			w.Write([]byte(`{"ok":true}`))
			return
		}
		if token.Load() == nil || r.Header.Get("Authorization") != "Bearer "+token.Load().(string) {
			w.WriteHeader(401)
			return
		}
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			verified <- err
			return
		}
		defer conn.CloseNow()
		fail := func(err error) { verified <- err }
		var incoming frame
		if err = wsjson.Read(ctx, conn, &incoming); err != nil {
			fail(err)
			return
		}
		if incoming.Type != "hello" {
			fail(errors.New("missing hello"))
			return
		}
		if err = wsjson.Write(ctx, conn, map[string]any{"type": "welcome", "sessionId": sid, "protocolVersion": 1}); err != nil {
			fail(err)
			return
		}
		if err = wsjson.Read(ctx, conn, &incoming); err != nil {
			fail(err)
			return
		}
		if incoming.Type != "ready" {
			fail(errors.New("missing ready"))
			return
		}
		if err = wsjson.Write(ctx, conn, map[string]any{"type": "request", "sessionId": sid, "requestId": rid, "topic": "processes", "timeoutMs": 4000}); err != nil {
			fail(err)
			return
		}
		if err = wsjson.Read(ctx, conn, &incoming); err != nil {
			fail(err)
			return
		}
		if incoming.Type != "ack" || incoming.RequestID != rid {
			fail(errors.New("missing ack"))
			return
		}
		<-started
		if err = wsjson.Write(ctx, conn, map[string]any{"type": "ping", "sessionId": sid, "nonce": rid}); err != nil {
			fail(err)
			return
		}
		if err = wsjson.Read(ctx, conn, &incoming); err != nil {
			fail(err)
			return
		}
		if incoming.Type != "pong" || incoming.Nonce != rid {
			fail(errors.New("collection blocked heartbeat"))
			return
		}
		close(release)
		if err = wsjson.Read(ctx, conn, &incoming); err != nil {
			fail(err)
			return
		}
		if incoming.Type != "result" || incoming.RequestID != rid {
			fail(errors.New("missing result"))
			return
		}
		verified <- nil
	}))
	defer server.Close()
	c := Client{Directory: t.TempDir(), Config: func() Config {
		return Config{Enabled: true, ServerURL: server.URL, AccessKey: "fixture-admin", DeviceID: "node"}
	}, Handle: func(ctx context.Context, _ string) (any, error) {
		close(started)
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-release:
			return map[string]any{"items": []string{}}, nil
		}
	}}
	done := make(chan struct{})
	go func() { defer close(done); _ = c.connect(ctx, c.Config()) }()
	select {
	case err := <-verified:
		if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	cancel()
	<-done
}

func TestEnrollmentDoesNotFollowRedirects(t *testing.T) {
	var leaks atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { leaks.Add(1) }))
	defer target.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer server.Close()
	c := Client{Directory: t.TempDir(), Config: func() Config {
		return Config{Enabled: true, ServerURL: server.URL, AccessKey: "fixture-admin", DeviceID: "node"}
	}}
	if err := c.connect(context.Background(), c.Config()); err == nil {
		t.Fatal("redirect accepted")
	}
	if leaks.Load() != 0 {
		t.Fatal("enrollment credentials followed redirect")
	}
}
