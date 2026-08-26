import { deepStrictEqual, strictEqual } from "node:assert/strict";
import test from "node:test";
import type { VirtualizationSnapshot } from "@dsc/shared";
import {
  shouldIngestVirtualMachineSnapshot,
  shouldReconcileVirtualMachineSnapshot,
  virtualMachineIdsToClose
} from "./virtual-machines.js";

function snapshot(overrides: Partial<VirtualizationSnapshot> = {}): VirtualizationSnapshot {
  return {
    platform: "proxmox",
    source: "https://pve.example/api2/json",
    collectedAt: "2026-08-26T00:00:00.000Z",
    nodes: [],
    vms: [],
    capabilities: [],
    ...overrides
  };
}

test("complete Proxmox snapshots are authoritative, including an empty VM list", () => {
  const complete = snapshot({ inventoryComplete: true });
  strictEqual(shouldIngestVirtualMachineSnapshot(complete), true);
  strictEqual(shouldReconcileVirtualMachineSnapshot(complete), true);
});

test("node-scoped or failed Proxmox snapshots cannot delete or resurrect registry entries", () => {
  strictEqual(shouldIngestVirtualMachineSnapshot(snapshot({ inventoryComplete: false })), false);
  strictEqual(shouldReconcileVirtualMachineSnapshot(snapshot({ inventoryComplete: false })), false);
  strictEqual(
    shouldIngestVirtualMachineSnapshot(snapshot({ inventoryComplete: true, issues: [{ code: "refresh_failed", message: "timeout" }] })),
    false
  );
  strictEqual(
    shouldReconcileVirtualMachineSnapshot(snapshot({ inventoryComplete: true, issues: [{ code: "refresh_failed", message: "timeout" }] })),
    false
  );
});

test("reconciliation closes only missing open records in the observed scope", () => {
  deepStrictEqual(
    virtualMachineIdsToClose(
      [
        { virtualMachineId: "vm:present", scopeKey: "proxmox:cluster", status: "open" },
        { virtualMachineId: "vm:deleted", scopeKey: "proxmox:cluster", status: "open" },
        { virtualMachineId: "vm:closed", scopeKey: "proxmox:cluster", status: "closed" },
        { virtualMachineId: "vm:other-scope", scopeKey: "proxmox:other", status: "open" }
      ],
      "proxmox:cluster",
      ["vm:present"]
    ),
    ["vm:deleted"]
  );
});
