import mysql, { type RowDataPacket } from "mysql2/promise";

export interface VirtualMachineRecord {
  virtualMachineId: string;
  scopeKey: string;
  externalId: string;
  platform: string;
  name: string;
  hostDeviceId: string;
  hostName: string;
  node: string | null;
  type: string | null;
  powerState: string;
  status: "open" | "closed";
  sortOrder: number;
  registeredAt: string;
  updatedAt: string;
  lastSeenAt: string;
}
export interface VirtualMachineRegistration {
  virtualMachineId: string;
  scopeKey: string;
  externalId: string;
  platform: string;
  name: string;
  hostDeviceId: string;
  hostName: string;
  node?: string | null;
  type?: string | null;
  powerState: string;
  observedAt: string;
}

export interface VirtualMachineRepository {
  init?(): Promise<void>;
  registerOrUpdate(input: VirtualMachineRegistration): Promise<VirtualMachineRecord>;
  listOpen(): Promise<VirtualMachineRecord[]>;
  reconcile(scopeKey: string, observedVirtualMachineIds: string[], observedAt: string): Promise<string[]>;
  delete(virtualMachineId: string): Promise<void>;
  reorder(virtualMachineIds: string[]): Promise<void>;
}

function sqlDate(value: string): string {
  return value.slice(0, 19).replace("T", " ");
}

export class MysqlVirtualMachineRepository implements VirtualMachineRepository {
  constructor(private readonly pool: mysql.Pool) {}

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS virtual_machines (
        virtual_machine_id VARCHAR(128) PRIMARY KEY,
        scope_key VARCHAR(512) NOT NULL,
        external_id VARCHAR(255) NOT NULL,
        platform VARCHAR(64) NOT NULL,
        name VARCHAR(255) NOT NULL,
        host_device_id VARCHAR(128) NOT NULL,
        host_name VARCHAR(255) NOT NULL,
        node_name VARCHAR(255) NULL,
        vm_type VARCHAR(64) NULL,
        power_state VARCHAR(64) NOT NULL DEFAULT 'unknown',
        status VARCHAR(32) NOT NULL DEFAULT 'open',
        sort_order INT NOT NULL DEFAULT 0,
        registered_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        last_seen_at DATETIME NOT NULL,
        UNIQUE KEY uniq_vm_scope_external (scope_key(191), external_id),
        INDEX idx_vm_status_sort (status, sort_order),
        INDEX idx_vm_host (host_device_id)
      )
    `);
  }

  async registerOrUpdate(input: VirtualMachineRegistration): Promise<VirtualMachineRecord> {
    const now = sqlDate(input.observedAt);
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT virtual_machine_id, scope_key, external_id, platform, name, host_device_id, host_name, node_name, vm_type, power_state, status, sort_order, registered_at, updated_at, last_seen_at
       FROM virtual_machines
       WHERE virtual_machine_id = ? OR (scope_key = ? AND external_id = ?)
       ORDER BY CASE WHEN virtual_machine_id = ? THEN 0 ELSE 1 END
       LIMIT 1`,
      [input.virtualMachineId, input.scopeKey, input.externalId, input.virtualMachineId]
    );

    if (rows.length > 0) {
      const existing = rows[0];
      await this.pool.query(
        `UPDATE virtual_machines
         SET scope_key = ?, external_id = ?, platform = ?, name = ?, host_device_id = ?, host_name = ?, node_name = ?, vm_type = ?, power_state = ?, status = 'open', updated_at = ?, last_seen_at = ?
         WHERE virtual_machine_id = ?`,
        [
          input.scopeKey,
          input.externalId,
          input.platform,
          input.name,
          input.hostDeviceId,
          input.hostName,
          input.node ?? null,
          input.type ?? null,
          input.powerState,
          now,
          now,
          existing.virtual_machine_id
        ]
      );
      return {
        virtualMachineId: existing.virtual_machine_id,
        scopeKey: input.scopeKey,
        externalId: input.externalId,
        platform: input.platform,
        name: input.name,
        hostDeviceId: input.hostDeviceId,
        hostName: input.hostName,
        node: input.node ?? null,
        type: input.type ?? null,
        powerState: input.powerState,
        status: "open",
        sortOrder: existing.sort_order,
        registeredAt: String(existing.registered_at),
        updatedAt: now,
        lastSeenAt: now
      };
    }

    const [maxRows] = await this.pool.query<RowDataPacket[]>(
      `SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM virtual_machines`
    );
    const sortOrder = Number(maxRows[0]?.max_order ?? -1) + 1;
    await this.pool.query(
      `INSERT INTO virtual_machines (virtual_machine_id, scope_key, external_id, platform, name, host_device_id, host_name, node_name, vm_type, power_state, status, sort_order, registered_at, updated_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
      [
        input.virtualMachineId,
        input.scopeKey,
        input.externalId,
        input.platform,
        input.name,
        input.hostDeviceId,
        input.hostName,
        input.node ?? null,
        input.type ?? null,
        input.powerState,
        sortOrder,
        now,
        now,
        now
      ]
    );
    return {
      virtualMachineId: input.virtualMachineId,
      scopeKey: input.scopeKey,
      externalId: input.externalId,
      platform: input.platform,
      name: input.name,
      hostDeviceId: input.hostDeviceId,
      hostName: input.hostName,
      node: input.node ?? null,
      type: input.type ?? null,
      powerState: input.powerState,
      status: "open",
      sortOrder,
      registeredAt: now,
      updatedAt: now,
      lastSeenAt: now
    };
  }

  async listOpen(): Promise<VirtualMachineRecord[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT virtual_machine_id AS virtualMachineId, scope_key AS scopeKey, external_id AS externalId, platform, name, host_device_id AS hostDeviceId, host_name AS hostName, node_name AS node, vm_type AS type, power_state AS powerState, status, sort_order AS sortOrder,
              DATE_FORMAT(registered_at, '%Y-%m-%dT%H:%i:%s.000Z') AS registeredAt,
              DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%s.000Z') AS updatedAt,
              DATE_FORMAT(last_seen_at, '%Y-%m-%dT%H:%i:%s.000Z') AS lastSeenAt
       FROM virtual_machines
       WHERE status = 'open'
       ORDER BY sort_order ASC, virtual_machine_id ASC`
    );
    return rows as VirtualMachineRecord[];
  }

  async reconcile(scopeKey: string, observedVirtualMachineIds: string[], observedAt: string): Promise<string[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT virtual_machine_id AS virtualMachineId
       FROM virtual_machines
       WHERE scope_key = ? AND status = 'open'`,
      [scopeKey]
    );
    const observed = new Set(observedVirtualMachineIds);
    const closedIds = rows
      .map((row) => String(row.virtualMachineId))
      .filter((virtualMachineId) => !observed.has(virtualMachineId));
    if (closedIds.length === 0) return [];

    const placeholders = closedIds.map(() => "?").join(", ");
    await this.pool.query(
      `UPDATE virtual_machines
       SET status = 'closed', updated_at = ?
       WHERE scope_key = ? AND status = 'open' AND virtual_machine_id IN (${placeholders})`,
      [sqlDate(observedAt), scopeKey, ...closedIds]
    );
    return closedIds;
  }

  async delete(virtualMachineId: string): Promise<void> {
    await this.pool.query(
      `UPDATE virtual_machines SET status = 'closed', updated_at = ? WHERE virtual_machine_id = ?`,
      [sqlDate(new Date().toISOString()), virtualMachineId]
    );
  }

  async reorder(virtualMachineIds: string[]): Promise<void> {
    const now = sqlDate(new Date().toISOString());
    for (let index = 0; index < virtualMachineIds.length; index += 1) {
      await this.pool.query(
        `UPDATE virtual_machines SET sort_order = ?, updated_at = ? WHERE virtual_machine_id = ?`,
        [index, now, virtualMachineIds[index]]
      );
    }
  }
}
