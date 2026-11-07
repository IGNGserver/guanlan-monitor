import mysql, { type RowDataPacket } from "mysql2/promise";
import {
  LEGACY_VIRTUAL_MACHINE_ID_PATTERN,
  isLegacyVirtualMachineId,
  legacyVirtualMachineRecord
} from "../legacy-devices.js";
import { isReservedDeviceGroupName, normalizeDeviceGroupName } from "@dsc/shared";
import { DeviceNotFoundError, InvalidDeviceGroupNameError, type DeviceRecord, type DeviceRegistrationOptions, type DeviceRepository } from "../types.js";
import { KeyedSerialQueue } from "../serial-queue.js";

export interface MysqlDeviceRepositoryOptions {
  listCacheTtlMs?: number;
}

export class MysqlDeviceRepository implements DeviceRepository {
  private readonly deviceQueues = new KeyedSerialQueue();
  // FIFO: only successful registry reads/writes enter the cache. Hits do not
  // refresh insertion order, and callers never receive the stored object.
  private readonly registeredDevices = new Map<string, DeviceRecord>();
  private readonly registrationCacheLimit = 4_096;
  private readonly listCacheTtlMs: number;
  private listCache?: { value: DeviceRecord[]; expiresAt: number };
  private readonly registryQueue = new KeyedSerialQueue();

  constructor(private readonly pool: mysql.Pool, options: MysqlDeviceRepositoryOptions = {}) {
    this.listCacheTtlMs = options.listCacheTtlMs ?? 0;
    if (!Number.isSafeInteger(this.listCacheTtlMs) || this.listCacheTtlMs < 0) throw new RangeError("listCacheTtlMs must be a non-negative integer");
  }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS devices (
        device_id VARCHAR(128) PRIMARY KEY,
        name VARCHAR(128) NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'open',
        sort_order INT NOT NULL DEFAULT 0,
        group_name VARCHAR(64) NULL DEFAULT NULL,
        registered_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
    `);
    const [columns] = await this.pool.query<RowDataPacket[]>(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'devices' AND COLUMN_NAME = 'group_name'`
    );
    if (columns.length === 0) {
      await this.pool.query(`ALTER TABLE devices ADD COLUMN group_name VARCHAR(64) NULL DEFAULT NULL AFTER sort_order`);
    }
    await this.pool.query(
      `UPDATE devices SET group_name = NULL WHERE LOWER(TRIM(group_name)) IN (?, ?, ?)`,
      ["all", "__all__", "__ungrouped__"]
    );
  }

  async registerOrUpdateDevice(
    deviceId: string,
    name?: string,
    options?: DeviceRegistrationOptions
  ): Promise<DeviceRecord> {
    // Refused before anything is read or written: the startup sweep deletes these rows, and a
    // concurrent GET /api/devices used to re-insert them from realtime state that the sweep had
    // not reached yet, leaving rows nothing would ever clean again.
    if (isLegacyVirtualMachineId(deviceId)) return legacyVirtualMachineRecord(deviceId);

    return this.registryQueue.run("registry", () => this.deviceQueues.run(deviceId, async () => {
      const cached = this.registeredDevices.get(deviceId);
      if (options?.skipUnchanged && cached?.status === "open" && (!name || name === cached.name)) {
        return { ...cached };
      }

      // A failed/ambiguous write must never leave an old successful fast path.
      this.registeredDevices.delete(deviceId);
      const record = await this.registerDeviceUncached(deviceId, name, options);
      this.registeredDevices.set(deviceId, { ...record });
      if (this.registeredDevices.size > this.registrationCacheLimit) {
        this.registeredDevices.delete(this.registeredDevices.keys().next().value!);
      }
      return { ...record };
    }));
  }

  private async registerDeviceUncached(
    deviceId: string,
    name?: string,
    options?: DeviceRegistrationOptions
  ): Promise<DeviceRecord> {
    const now = new Date();
    const formattedNow = now.toISOString().slice(0, 19).replace("T", " ");

    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT device_id, name, status, sort_order, group_name, registered_at, updated_at FROM devices WHERE device_id = ?`,
      [deviceId]
    );

    if (rows.length > 0) {
      const existing = rows[0];
      if (existing.status === "closed" && !options?.reopenClosed) {
        return {
          deviceId: existing.device_id,
          name: existing.name,
          status: "closed",
          sortOrder: existing.sort_order,
          group: existing.group_name ?? null,
          registeredAt: String(existing.registered_at),
          updatedAt: String(existing.updated_at)
        };
      }
      const deviceName = name || existing.name;
      await this.pool.query(
        `UPDATE devices SET name = ?, status = 'open', updated_at = ? WHERE device_id = ?`,
        [deviceName, formattedNow, deviceId]
      );
      this.listCache = undefined;
      return {
        deviceId: existing.device_id,
        name: deviceName,
        status: "open",
        sortOrder: existing.sort_order,
        group: existing.group_name ?? null,
        registeredAt: String(existing.registered_at),
        updatedAt: formattedNow
      };
    } else {
      const [maxOrderRows] = await this.pool.query<RowDataPacket[]>(
        `SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM devices`
      );
      const nextSortOrder = (maxOrderRows[0]?.max_order ?? -1) + 1;
      const deviceName = name || deviceId;

      await this.pool.query(
        `INSERT INTO devices (device_id, name, status, sort_order, registered_at, updated_at) VALUES (?, ?, 'open', ?, ?, ?)`,
        [deviceId, deviceName, nextSortOrder, formattedNow, formattedNow]
      );
      this.listCache = undefined;

      return {
        deviceId,
        name: deviceName,
        status: "open",
        sortOrder: nextSortOrder,
        group: null,
        registeredAt: formattedNow,
        updatedAt: formattedNow
      };
    }
  }

  async listOpenDevices(): Promise<DeviceRecord[]> {
    return this.registryQueue.run("registry", async () => {
      // Filtered in SQL rather than in memory so a deployment upgraded before the startup sweep
      // finished still never surfaces legacy ids, and so every caller shares one definition of the
      // device list.
      if (this.listCache && this.listCache.expiresAt > Date.now()) {
        return structuredClone(this.listCache.value);
      }
      const [rows] = await this.pool.query<RowDataPacket[]>(
        `SELECT device_id AS deviceId, name, status, sort_order AS sortOrder, group_name AS \`group\`, DATE_FORMAT(registered_at, '%Y-%m-%dT%H:%i:%s.000Z') AS registeredAt, DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%s.000Z') AS updatedAt FROM devices WHERE status = 'open' AND device_id NOT LIKE ? ORDER BY sort_order ASC, device_id ASC`,
        [LEGACY_VIRTUAL_MACHINE_ID_PATTERN]
      );
      const records = rows as DeviceRecord[];
      if (this.listCacheTtlMs > 0) {
        this.listCache = { value: structuredClone(records), expiresAt: Date.now() + this.listCacheTtlMs };
      }
      return records;
    });
  }

  async getOpenDevice(deviceId: string): Promise<DeviceRecord | null> {
    if (isLegacyVirtualMachineId(deviceId)) return null;
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT device_id AS deviceId, name, status, sort_order AS sortOrder, group_name AS \`group\`, DATE_FORMAT(registered_at, '%Y-%m-%dT%H:%i:%s.000Z') AS registeredAt, DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%s.000Z') AS updatedAt FROM devices WHERE device_id = ? AND status = 'open'`,
      [deviceId]
    );
    const record = rows[0] as DeviceRecord | undefined;
    return record ? { ...record, group: record.group ?? null } : null;
  }

  async deleteDevice(deviceId: string): Promise<void> {
    // A soft delete is an INSERT here, so it is the one other path that could resurrect a legacy
    // row the sweep just removed.
    if (isLegacyVirtualMachineId(deviceId)) return;
    await this.registryQueue.run("registry", () => this.deviceQueues.run(deviceId, async () => {
      this.registeredDevices.delete(deviceId);
      this.listCache = undefined;
      const formattedNow = new Date().toISOString().slice(0, 19).replace("T", " ");
      await this.pool.query(
        `
          INSERT INTO devices (device_id, name, status, sort_order, registered_at, updated_at)
          VALUES (?, ?, 'closed', 0, ?, ?)
          ON DUPLICATE KEY UPDATE status = 'closed', updated_at = ?
        `,
        [deviceId, deviceId, formattedNow, formattedNow, formattedNow]
      );
    }));
  }

  async reorderDevices(deviceIds: string[]): Promise<void> {
    const formattedNow = new Date().toISOString().slice(0, 19).replace("T", " ");
    for (let i = 0; i < deviceIds.length; i++) {
      const deviceId = deviceIds[i];
      if (isLegacyVirtualMachineId(deviceId)) continue;
      await this.registryQueue.run("registry", () => this.deviceQueues.run(deviceId, async () => {
        this.registeredDevices.delete(deviceId);
        this.listCache = undefined;
        await this.pool.query(
          `UPDATE devices SET sort_order = ?, updated_at = ? WHERE device_id = ?`,
          [i, formattedNow, deviceId]
        );
      }));
    }
  }

  async updateDeviceGroup(deviceIds: string[], group: string | null): Promise<void> {
    const normalizedGroup = normalizeDeviceGroupName(group)?.slice(0, 64) ?? null;
    if (normalizedGroup && isReservedDeviceGroupName(normalizedGroup)) throw new InvalidDeviceGroupNameError();
    const formattedNow = new Date().toISOString().slice(0, 19).replace("T", " ");
    const uniqueIds = [...new Set(deviceIds)];
    if (!uniqueIds.length) return;
    if (uniqueIds.some(isLegacyVirtualMachineId)) throw new DeviceNotFoundError(uniqueIds.find(isLegacyVirtualMachineId)!);
    const placeholders = uniqueIds.map(() => "?").join(", ");
    const poolWithConnection = this.pool as mysql.Pool & {
      getConnection?: () => Promise<mysql.PoolConnection>;
    };
    await this.registryQueue.run("registry", async () => {
      this.listCache = undefined;
      for (const deviceId of uniqueIds) this.registeredDevices.delete(deviceId);
      if (!poolWithConnection.getConnection) {
        for (const deviceId of uniqueIds) {
          if (!(await this.getOpenDevice(deviceId))) throw new DeviceNotFoundError(deviceId);
          await this.pool.query(
            `UPDATE devices SET group_name = ?, updated_at = ? WHERE status = 'open' AND device_id = ?`,
            [normalizedGroup, formattedNow, deviceId]
          );
        }
        return;
      }

      const connection = await poolWithConnection.getConnection();
      try {
        await connection.beginTransaction();
        const [rows] = await connection.query<RowDataPacket[]>(
          `SELECT device_id FROM devices WHERE status = 'open' AND device_id IN (${placeholders}) FOR UPDATE`,
          uniqueIds
        );
        const openIds = new Set(rows.map((row) => String(row.device_id)));
        const missing = uniqueIds.find((deviceId) => !openIds.has(deviceId));
        if (missing) throw new DeviceNotFoundError(missing);
        await connection.query(
          `UPDATE devices SET group_name = ?, updated_at = ? WHERE status = 'open' AND device_id IN (${placeholders})`,
          [normalizedGroup, formattedNow, ...uniqueIds]
        );
        await connection.commit();
      } catch (error) {
        await connection.rollback().catch(() => undefined);
        throw error;
      } finally {
        connection.release();
      }
    });
  }
}
