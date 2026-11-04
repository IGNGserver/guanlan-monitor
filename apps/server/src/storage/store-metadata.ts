import type mysql from "mysql2/promise";
import { createHash } from "node:crypto";

/**
 * Guard a database against accidental multi-instance writes.
 *
 * Different projects may share one MySQL server, but they must never share a
 * database: the Hub's table names are fixed. The first Hub to initialize the
 * database records its instance id; a later Hub with a different id is refused.
 */
export interface MysqlStoreMetadataOptions {
  writerLock?: boolean;
  /** Distinguishes databases on one MySQL server; MySQL locks are server-wide. */
  databaseName?: string;
  /** Optional dedicated connection factory; avoids taking a pool slot. */
  connect?: () => Promise<mysql.Connection>;
}

export class MysqlStoreMetadata {
  private lockConnection?: mysql.Connection | mysql.PoolConnection;
  private lockOwnsConnection = false;
  private readonly lockName: string;

  constructor(
    private readonly pool: mysql.Pool,
    private readonly instanceId: string,
    private readonly options: MysqlStoreMetadataOptions = {}
  ) {
    this.lockName = `guanlan:${createHash("sha256").update(`${options.databaseName ?? ""}\0${instanceId}`).digest("hex").slice(0, 32)}`;
  }

  async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS hub_meta (
        meta_key VARCHAR(64) NOT NULL PRIMARY KEY,
        meta_value VARCHAR(255) NOT NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
    `);
    await this.pool.query(
      `INSERT INTO hub_meta (meta_key, meta_value) VALUES ('instance_id', ?)
         ON DUPLICATE KEY UPDATE meta_value = meta_value`,
      [this.instanceId]
    );
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT meta_value FROM hub_meta WHERE meta_key = 'instance_id'`
    );
    const stored = String(rows[0]?.meta_value ?? "");
    if (stored !== this.instanceId) {
      throw new Error(
        `This MySQL database belongs to instance "${stored || "unknown"}", not "${this.instanceId}". Use a separate database per hub.`
      );
    }
    await this.pool.query(
      `INSERT INTO hub_meta (meta_key, meta_value) VALUES ('schema_version', '1')
         ON DUPLICATE KEY UPDATE meta_value = meta_value`
    );
  }

  /**
   * Hold a MySQL advisory lock for the process lifetime. The lock is scoped to
   * this database server, so two Hub processes cannot both write the same
   * database even if they were started with the same instance id.
   */
  async acquireWriterLock(): Promise<void> {
    if (this.options.writerLock === false || this.lockConnection) return;
    const ownsConnection = Boolean(this.options.connect);
    const connection = this.options.connect ? await this.options.connect() : await this.pool.getConnection();
    try {
      const [rows] = await connection.query<mysql.RowDataPacket[]>({
        sql: "SELECT GET_LOCK(?, 0) AS acquired",
        values: [this.lockName],
        timeout: 5_000
      });
      if (Number(rows[0]?.acquired) !== 1) {
        throw new Error("Another Hub process already owns this MySQL database.");
      }
      this.lockConnection = connection;
      this.lockOwnsConnection = ownsConnection;
    } catch (error) {
      if (ownsConnection) await connection.end().catch(() => undefined);
      else (connection as mysql.PoolConnection).release();
      throw error;
    }
  }

  async releaseWriterLock(): Promise<void> {
    const connection = this.lockConnection;
    if (!connection) return;
    this.lockConnection = undefined;
    const ownsConnection = this.lockOwnsConnection;
    this.lockOwnsConnection = false;
    try {
      await connection.query({ sql: "SELECT RELEASE_LOCK(?)", values: [this.lockName], timeout: 5_000 });
    } finally {
      if (ownsConnection) await connection.end().catch(() => undefined);
      else (connection as mysql.PoolConnection).release();
    }
  }
}
