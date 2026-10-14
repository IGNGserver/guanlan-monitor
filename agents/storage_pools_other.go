//go:build !linux

package main

// Storage pools are collected on Linux, where the Proxmox, LVM and ZFS
// sources live. Other platforms report no pools rather than an empty
// placeholder: the Hub marks the metric unavailable when the list is empty, so
// the console hides the section instead of drawing an empty one.
func collectGenericStoragePools() ([]storagePoolStats, error) {
	return nil, nil
}
