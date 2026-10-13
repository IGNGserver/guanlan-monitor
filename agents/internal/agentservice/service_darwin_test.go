//go:build darwin

package agentservice

import (
	"bytes"
	"encoding/xml"
	"io"
	"testing"
)

func TestLaunchDaemonUsesArgumentsNotShell(t *testing.T) {
	spec := Spec{Executable: "/Applications/观澜.app/Contents/Resources/agent/guanlan-agent", ConfigDir: "/Library/Application Support/Guanlan", BundleRoot: "/Applications/观澜.app/Contents/Resources/agent", Arguments: []string{"--service-mode", "--config-root", "/config with spaces & <quotes>", "$(touch /tmp/never-executed)"}}
	data, err := renderLaunchDaemon(spec)
	if err != nil {
		t.Fatal(err)
	}
	decoder := xml.NewDecoder(bytes.NewReader(data))
	values := []string{}
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		if element, ok := token.(xml.StartElement); ok && element.Name.Local == "string" {
			var value string
			if err := decoder.DecodeElement(&value, &element); err != nil {
				t.Fatal(err)
			}
			values = append(values, value)
		}
	}
	found := false
	for _, value := range values {
		if value == spec.Arguments[2] {
			found = true
		}
	}
	if !found {
		t.Fatalf("argument escaping lost content: %v", values)
	}
	if bytes.Contains(data, []byte("/bin/sh")) || bytes.Contains(data, []byte("LaunchAgent")) {
		t.Fatal("unsafe/user-session service")
	}
}

func TestLaunchDaemonRejectsRelativePaths(t *testing.T) {
	if _, err := renderLaunchDaemon(Spec{Executable: "relative", ConfigDir: "/config", BundleRoot: "/bundle"}); err == nil {
		t.Fatal("accepted relative executable")
	}
	if err := trustedRootPath(t.TempDir()); err == nil {
		t.Fatal("accepted user-owned service path")
	}
}
