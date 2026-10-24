package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"testing"
)

func TestRepositoryFixtureNodeGolden(t *testing.T) {
	file := filepath.Join(t.TempDir(), "batch.json")
	if out, err := exec.Command("node", "../generate.mjs", file, "8").CombinedOutput(); err != nil {
		t.Fatalf("generator: %v %s", err, out)
	}
	node, err := exec.Command("node", "../language.mjs", file).Output()
	if err != nil {
		t.Fatal(err)
	}
	var golden struct {
		Result any    `json:"result"`
		Hash   string `json:"canonicalSha256"`
	}
	if err = json.Unmarshal(node, &golden); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := transform(raw)
	if err != nil {
		t.Fatal(err)
	}
	var result any
	if err = json.Unmarshal(encoded, &result); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(result, golden.Result) {
		t.Fatal("Go and Node semantic outputs differ")
	}
	if canonicalSha256(result) != golden.Hash {
		t.Fatal("canonical digest differs")
	}
	if golden.Hash != "0ff22bb64f46b2bf2ba13880af0db85daa0cccfd682edf34c7c6c4d33c415caf" {
		t.Fatal("repository fixture golden changed")
	}
	if len(result.(map[string]any)["records"].([]any)) != 8 {
		t.Fatal("replay not deduplicated")
	}
}

func TestRejectInvalidInput(t *testing.T) {
	for _, raw := range []string{`null`, `{}`, `invalid`, `[null]`, `[{"identity":{"deviceId":"x"},"timestamp":"bad"}]`, `[9007199254740992]`} {
		if _, err := transform([]byte(raw)); err == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
	if _, err := transform([]byte(`[]`)); err != nil {
		t.Fatal(err)
	}
}
