//go:build linux

package agentservice

import (
	"strings"
	"testing"
)

func TestRenderUnitProducesBootTimeSystemUnit(t *testing.T) {
	unit := renderUnit(Spec{
		Executable:  "/opt/guanlan/guanlan-agent",
		Arguments:   []string{"--service-mode", "--config-root", "/etc/guanlan"},
		DisplayName: "Guanlan device status agent",
	}, "guanlan")

	for _, expected := range []string{
		"[Unit]",
		"After=network-online.target",
		"WantedBy=multi-user.target",
		"Restart=always",
		"User=guanlan",
		"ExecStart=/opt/guanlan/guanlan-agent --service-mode --config-root /etc/guanlan",
	} {
		if !strings.Contains(unit, expected) {
			t.Fatalf("unit is missing %q:\n%s", expected, unit)
		}
	}

	// A graphical session must never be a dependency: the whole point of the
	// service is to run with nobody logged in.
	if strings.Contains(unit, "graphical-session") {
		t.Fatalf("the service unit must not depend on a desktop session:\n%s", unit)
	}
}

func TestRenderUnitOmitsUserWhenRunningAsRoot(t *testing.T) {
	unit := renderUnit(Spec{Executable: "/opt/guanlan/guanlan-agent"}, "")
	if strings.Contains(unit, "User=") {
		t.Fatalf("root unit must not pin a user:\n%s", unit)
	}
}

func TestQuoteUnitEscapesSpaces(t *testing.T) {
	if got := quoteUnit("/opt/my agent/guanlan-agent"); got != `"/opt/my agent/guanlan-agent"` {
		t.Fatalf("quoteUnit = %s", got)
	}
	if got := quoteUnit("/opt/guanlan/guanlan-agent"); got != "/opt/guanlan/guanlan-agent" {
		t.Fatalf("quoteUnit = %s", got)
	}
}

func TestQueryWithoutInstalledUnitReportsNone(t *testing.T) {
	if unitExists() {
		t.Skip("a guanlan-agent unit is installed on this host")
	}
	status, err := Query()
	if err != nil {
		t.Fatal(err)
	}
	if status.Installed || status.Running {
		t.Fatalf("status = %+v, want an uninstalled service", status)
	}
	if status.Kind != KindNone {
		t.Fatalf("kind = %q, want %q", status.Kind, KindNone)
	}
}
