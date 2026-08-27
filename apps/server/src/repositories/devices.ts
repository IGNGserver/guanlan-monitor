import mysql, { type RowDataPacket } from "mysql2/promise";
import type { DeviceRecord, DeviceRepository } from "../types.js";

export class MysqlDeviceRepository implements DeviceRepository {
  constructor(private readonly pool: mysql.Pool) {}

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS devices (
        device_id VARCHAR(128) PRIMARY KEY,
        name VARCHAR(128) NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'open',
        sort_order INT NOT NULL DEFAULT 0,
        registered_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL
      )
    `);
  }

  async registerOrUpdateDevice(deviceId: string, name?: string): Promise<DeviceRecord> {
    const now = new Date();
    const formattedNow = now.toISOString().slice(0, 19).replace("T", " ");

    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT device_id, name, status, sort_order, registered_at, updated_at FROM devices WHERE device_id = ?`,
      [deviceId]
    );

    if (rows.length > 0) {
      const existing = rows[0];
      if (existing.status === "closed") {
        return {
          deviceId: existing.device_id,
          name: existing.name,
          status: "closed",
          sortOrder: existing.sort_order,
          registeredAt: String(existing.registered_at),
          updatedAt: String(existing.updated_at)
        };
      }
      await this.pool.query(
        `UPDATE devices SET status = 'open', updated_at = ? WHERE device_id = ?`,
        [formattedNow, deviceId]
      );
      return {
        deviceId: existing.device_id,
        name: name || existing.name,
        status: "open",
        sortOrder: existing.sort_order,
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

      return {
        deviceId,
        name: deviceName,
        status: "open",
        sortOrder: nextSortOrder,
        registeredAt: formattedNow,
        updatedAt: formattedNow
      };
    }
  }

  async listOpenDevices(): Promise<DeviceRecord[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT device_id AS deviceId, name, status, sort_order AS sortOrder, DATE_FORMAT(registered_at, '%Y-%m-%dT%H:%i:%s.000Z') AS registeredAt, DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%s.000Z') AS updatedAt FROM devices WHERE status = 'open' ORDER BY sort_order ASC, device_id ASC`
    );
    return rows as DeviceRecord[];
  }

  async deleteDevice(deviceId: string): Promise<void> {
    const formattedNow = new Date().toISOString().slice(0, 19).replace("T", " ");
    await this.pool.query(
      `
        INSERT INTO devices (device_id, name, status, sort_order, registered_at, updated_at)
        VALUES (?, ?, 'closed', 0, ?, ?)
        ON DUPLICATE KEY UPDATE status = 'closed', updated_at = ?
      `,
      [deviceId, deviceId, formattedNow, formattedNow, formattedNow]
    );
  }

  async reorderDevices(deviceIds: string[]): Promise<void> {
    const formattedNow = new Date().toISOString().slice(0, 19).replace("T", " ");
    for (let i = 0; i < deviceIds.length; i++) {
      await this.pool.query(
        `UPDATE devices SET sort_order = ?, updated_at = ? WHERE device_id = ?`,
        [i, formattedNow, deviceIds[i]]
      );
    }
  }
}
