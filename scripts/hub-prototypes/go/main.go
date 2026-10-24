// Research-only CPU kernel. This is not a Hub server or a production adapter.
package main

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"syscall"
	"time"
)

var metricKeys = []string{"cpuUsagePercent", "memoryUsagePercent", "diskUsagePercent", "networkRxBytesPerSec", "networkTxBytesPerSec"}
var timestampPattern = regexp.MustCompile(`^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$`)

func validateNumbers(value any) error {
	switch item := value.(type) {
	case float64:
		if math.IsNaN(item) || math.IsInf(item, 0) || math.Abs(item) > 9007199254740991 {
			return errors.New("only finite safe-number range supported")
		}
	case []any:
		for _, child := range item {
			if err := validateNumbers(child); err != nil {
				return err
			}
		}
	case map[string]any:
		for _, child := range item {
			if err := validateNumbers(child); err != nil {
				return err
			}
		}
	}
	return nil
}

func number(value any) (float64, error) {
	n, ok := value.(float64)
	if !ok || math.IsNaN(n) || math.IsInf(n, 0) {
		return 0, errors.New("invalid summary metric")
	}
	return n, nil
}

func ratio(value any) (float64, error) {
	object, ok := value.(map[string]any)
	if !ok {
		return 0, errors.New("invalid capacity")
	}
	total, err := number(object["totalBytes"])
	if err != nil {
		return 0, err
	}
	used, err := number(object["usedBytes"])
	if err != nil {
		return 0, err
	}
	if total <= 0 {
		return 0, nil
	}
	return used / total * 100, nil
}

func transform(raw []byte) ([]byte, error) {
	var input any
	if err := json.Unmarshal(raw, &input); err != nil {
		return nil, err
	}
	batch, ok := input.([]any)
	if !ok {
		return nil, errors.New("batch must be an array")
	}
	if err := validateNumbers(batch); err != nil {
		return nil, err
	}
	devices := map[string]map[string]map[string]any{}
	for _, item := range batch {
		payload, ok := item.(map[string]any)
		if !ok {
			return nil, errors.New("invalid payload")
		}
		identity, ok := payload["identity"].(map[string]any)
		if !ok {
			return nil, errors.New("invalid identity")
		}
		device, ok := identity["deviceId"].(string)
		if !ok || device == "" {
			return nil, errors.New("invalid identity")
		}
		timestamp, ok := payload["timestamp"].(string)
		if !ok || !timestampPattern.MatchString(timestamp) {
			return nil, errors.New("invalid timestamp")
		}
		if _, err := time.Parse("2006-01-02T15:04:05.000Z", timestamp); err != nil {
			return nil, err
		}
		if devices[device] == nil {
			devices[device] = map[string]map[string]any{}
		}
		devices[device][timestamp] = payload
	}
	records := []any{}
	summary := []any{}
	deviceKeys := make([]string, 0, len(devices))
	for key := range devices {
		deviceKeys = append(deviceKeys, key)
	}
	sort.Strings(deviceKeys)
	for _, device := range deviceKeys {
		points := devices[device]
		timestamps := make([]string, 0, len(points))
		for key := range points {
			timestamps = append(timestamps, key)
		}
		sort.Strings(timestamps)
		sums := make([]float64, 5)
		for _, timestamp := range timestamps {
			payload := points[timestamp]
			cpu, err := number(payload["cpuUsagePercent"])
			if err != nil {
				return nil, err
			}
			memory, err := ratio(payload["memory"])
			if err != nil {
				return nil, err
			}
			disk, err := ratio(payload["diskUsage"])
			if err != nil {
				return nil, err
			}
			network, ok := payload["networkRate"].(map[string]any)
			if !ok {
				return nil, errors.New("invalid network")
			}
			rx, err := number(network["rxBytesPerSec"])
			if err != nil {
				return nil, err
			}
			tx, err := number(network["txBytesPerSec"])
			if err != nil {
				return nil, err
			}
			for index, value := range []float64{cpu, memory, disk, rx, tx} {
				sums[index] += value
			}
			records = append(records, payload)
		}
		metrics := map[string]any{}
		for index, key := range metricKeys {
			metrics[key] = sums[index] / float64(len(points))
		}
		summary = append(summary, map[string]any{"deviceId": device, "sampleCount": len(points), "metrics": metrics})
	}
	return json.Marshal(map[string]any{"records": records, "summary": summary})
}

func canonicalSha256(value any) string {
	hash := sha256.New()
	var emit func(any)
	emit = func(value any) {
		switch item := value.(type) {
		case nil:
			io.WriteString(hash, "n")
		case bool:
			if item {
				io.WriteString(hash, "t")
			} else {
				io.WriteString(hash, "f")
			}
		case float64:
			if item == 0 {
				item = 0
			}
			bytes := make([]byte, 8)
			binary.BigEndian.PutUint64(bytes, math.Float64bits(item))
			io.WriteString(hash, "d"+hex.EncodeToString(bytes))
		case string:
			fmt.Fprintf(hash, "s%d:", len([]byte(item)))
			io.WriteString(hash, item)
		case []any:
			fmt.Fprintf(hash, "a%d:", len(item))
			for _, child := range item {
				emit(child)
			}
		case map[string]any:
			keys := make([]string, 0, len(item))
			for key := range item {
				keys = append(keys, key)
			}
			sort.Strings(keys)
			fmt.Fprintf(hash, "o%d:", len(keys))
			for _, key := range keys {
				emit(key)
				emit(item[key])
			}
		default:
			panic("canonical input must be JSON-decoded")
		}
	}
	emit(value)
	return hex.EncodeToString(hash.Sum(nil))
}

func usage() syscall.Rusage {
	var result syscall.Rusage
	if err := syscall.Getrusage(syscall.RUSAGE_SELF, &result); err != nil {
		panic(err)
	}
	return result
}
func millis(value syscall.Timeval) float64 { return float64(value.Sec)*1000 + float64(value.Usec)/1000 }

func run() error {
	if len(os.Args) < 2 || len(os.Args) > 3 {
		return errors.New("usage: ingest INPUT [ITERATIONS=0]")
	}
	iterations := 0
	if len(os.Args) == 3 {
		n, err := strconv.Atoi(os.Args[2])
		if err != nil || n < 0 {
			return errors.New("invalid iterations")
		}
		iterations = n
	}
	raw, err := os.ReadFile(os.Args[1])
	if err != nil {
		return err
	}
	var encoded []byte
	var measurements map[string]any
	if iterations == 0 {
		encoded, err = transform(raw)
		if err != nil {
			return err
		}
	} else {
		for i := 0; i < 3; i++ {
			if _, err = transform(raw); err != nil {
				return err
			}
		}
		cpu := usage()
		wall := time.Now()
		latencies := make([]float64, iterations)
		for i := range latencies {
			start := time.Now()
			encoded, err = transform(raw)
			if err != nil {
				return err
			}
			latencies[i] = float64(time.Since(start).Nanoseconds()) / 1e6
		}
		wallMs := float64(time.Since(wall).Nanoseconds()) / 1e6
		used := usage()
		sort.Float64s(latencies)
		rss := used.Maxrss
		if runtime.GOOS != "darwin" {
			rss *= 1024
		}
		measurements = map[string]any{"iterations": iterations, "inputBytes": len(raw), "outputBytes": len(encoded), "wallMs": wallMs,
			"cpuUserMs": millis(used.Utime) - millis(cpu.Utime), "cpuSystemMs": millis(used.Stime) - millis(cpu.Stime), "peakRssBytes": rss,
			"p50BatchMs": latencies[int(math.Ceil(float64(iterations)*0.5))-1], "p95BatchMs": latencies[int(math.Ceil(float64(iterations)*0.95))-1]}
	}
	var result any
	if err := json.Unmarshal(encoded, &result); err != nil {
		return err
	}
	output := map[string]any{"canonicalSha256": canonicalSha256(result)}
	if iterations == 0 {
		output["result"] = result
	} else {
		output["measurements"] = measurements
	}
	return json.NewEncoder(os.Stdout).Encode(output)
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
