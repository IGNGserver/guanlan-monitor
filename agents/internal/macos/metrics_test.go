package macos

import (
	"encoding/binary"
	"math"
	"testing"
)

func TestMemoryAccountsPhysicalCompression(t *testing.T) {
	value, err := MemoryFromPages(100*16384, 16384, 40, 5, 10, 8, 20)
	if err != nil {
		t.Fatal(err)
	}
	if value.Used != 53*16384 || value.Available != 47*16384 || value.Cached != 25*16384 || value.Compressed != 8*16384 {
		t.Fatalf("incorrect VM accounting: %+v", value)
	}
	for _, input := range [][7]uint64{{0, 4096, 0, 0, 0, 0, 0}, {4096, 0, 0, 0, 0, 0, 0}, {4096, 4096, 0, 1, 0, 0, 0}, {4096, 4096, 1, 0, 1, 0, 0}, {4096, 4096, 0, 0, 0, 0, 2}} {
		if _, err := MemoryFromPages(input[0], input[1], input[2], input[3], input[4], input[5], input[6]); err == nil {
			t.Fatalf("accepted inconsistent VM stats: %v", input)
		}
	}
}

func TestSMCDecodingDoesNotInventUnsupportedValues(t *testing.T) {
	for _, entry := range []struct {
		kind string
		data []byte
		want float64
	}{{"sp78", []byte{0x2a, 0x80}, 42.5}, {"sp78", []byte{0xff, 0x80}, -0.5}, {"fpe2", []byte{0x1f, 0x40}, 2000}, {"ui8 ", []byte{0}, 0}} {
		value, err := DecodeSMC(entry.kind, entry.data)
		if err != nil || *value != entry.want {
			t.Fatalf("%s: %v %v", entry.kind, value, err)
		}
	}
	nan := make([]byte, 4)
	binary.LittleEndian.PutUint32(nan, math.Float32bits(float32(math.NaN())))
	for _, entry := range []struct {
		kind string
		data []byte
	}{{"sp78", []byte{0}}, {"unknown", []byte{0, 0}}, {"flt ", nan}} {
		if value, err := DecodeSMC(entry.kind, entry.data); err == nil || value != nil {
			t.Fatalf("accepted bad SMC value: %v", entry)
		}
	}
}

func TestFrequencyUsesResidenciesAndRejectsStateIndices(t *testing.T) {
	channels := []FrequencyChannel{{Name: "ECPU0", States: []State{{Name: "IDLE", Residency: 100}, {Name: "1000 MHz", Residency: 25}, {Name: "2 GHz", Residency: 75}}}}
	value := Frequency(channels)
	if value == nil || *value != 1750 {
		t.Fatalf("frequency=%v", value)
	}
	for _, label := range []string{"V2", "P1", "1500", "bad MHz"} {
		if Frequency([]FrequencyChannel{{States: []State{{Name: label, Residency: 1}}}}) != nil {
			t.Fatalf("guessed frequency from %s", label)
		}
	}
	if Frequency([]FrequencyChannel{{States: []State{{Name: "1000 MHz", Residency: -1}}}}) != nil {
		t.Fatal("accepted reset counter")
	}
	if Frequency([]FrequencyChannel{{States: []State{{Name: "IDLE", Residency: 10}}}}) != nil {
		t.Fatal("idle is not an observed active clock")
	}
}

func TestAPFSContainersDoNotMultiplySiblingVolumeCapacity(t *testing.T) {
	data := []byte(`{"Containers":[{"APFSContainerUUID":"pool-1","CapacityCeiling":1000,"CapacityFree":400,"PhysicalStores":[{"DeviceIdentifier":"disk0s2"}],"Volumes":[{"MountPoint":"/System/Volumes/Data","Name":"Data"},{"MountPoint":"/","Name":"System"},{"MountPoint":"/System/Volumes/Preboot"}]},{"APFSContainerUUID":"pool-1","CapacityCeiling":1000,"CapacityFree":400}]}`)
	containers, err := ParseAPFS(data)
	if err != nil || len(containers) != 1 {
		t.Fatalf("containers=%v err=%v", containers, err)
	}
	id, _, mount := APFSIdentity(containers[0])
	if id != "apfs-pool-1" || mount != "/" {
		t.Fatalf("wrong identity: %s %s", id, mount)
	}
	if _, err := ParseAPFS([]byte(`{"Containers":[{"ContainerReference":"disk3","CapacityCeiling":100,"CapacityFree":101}]}`)); err == nil {
		t.Fatal("accepted impossible capacity")
	}
}

func TestFrequencyTableRequiresCompleteOneToOneStateMapping(t *testing.T) {
	channel := FrequencyChannel{Table: []float64{1000, 2000}, States: []State{{Name: "IDLE", Residency: 40}, {Name: "V0", Residency: 1}, {Name: "V1", Residency: 3}}}
	if value := Frequency([]FrequencyChannel{channel}); value == nil || *value != 1750 {
		t.Fatalf("DVFM mapping=%v", value)
	}
	channel.Table = append(channel.Table, 3000)
	if Frequency([]FrequencyChannel{channel}) != nil {
		t.Fatal("accepted table/state count mismatch")
	}
	channel.Table = []float64{1000, 2000}
	channel.States[2].Name = "V3"
	if Frequency([]FrequencyChannel{channel}) != nil {
		t.Fatal("accepted out-of-range state index")
	}
}
