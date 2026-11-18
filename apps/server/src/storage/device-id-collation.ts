import type mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";

/** Tables whose `device_id` column participates in the device identity contract. */
export type DeviceIdTable = "devices" | "device_minute_metrics" | "device_hourly_metrics";

const DEVICE_ID_TABLES: ReadonlySet<string> = new Set<DeviceIdTable>([
  "devices",
  "device_minute_metrics",
  "device_hourly_metrics"
]);

/**
 * Device ids are case-sensitive in every layer that compares them: in-memory
 * `Map`/`Set` keys, Redis keys, API paths and the `COLLATE=utf8mb4_bin` DDL.
 * Tables created before that DDL was introduced still inherit the database's
 * case-insensitive collation, and `CREATE TABLE IF NOT EXISTS` never repairs
 * them. With a case-insensitive column, a case-only id change (for example
 * `nas2` -> `NAS2`) updates the old row and returns its old casing while
 * realtime state stays keyed by the new one, so the registry and realtime
 * views disagree and one device can be listed twice.
 *
 * Runs once per table at startup and is a no-op after the column is binary.
 * MySQL rebuilds the table/indexes while changing the collation, so this may
 * take a while on a large history table.
 */
export async function ensureCaseSensitiveDeviceId(pool: mysql.Pool, table: DeviceIdTable): Promise<boolean> {
  // The table name cannot be a placeholder; keep the call sites and this set
  // in sync so no unexpected identifier ever reaches the ALTER statement.
  if (!DEVICE_ID_TABLES.has(table)) throw new RangeError(`unsupported device id table: ${table}`);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COLLATION_NAME AS collationName
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'device_id'`,
    [table]
  );
  const collation = String(rows[0]?.collationName ?? "").toLowerCase();
  if (!collation || collation === "utf8mb4_bin") return false;
  await pool.query(
    `ALTER TABLE ${table} MODIFY device_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL`
  );
  return true;
}
