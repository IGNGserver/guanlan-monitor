import mysql from "mysql2/promise";

export interface MysqlPoolSettings {
  connectionLimit: number;
  queueLimit: number;
  connectTimeoutMs: number;
  idleTimeoutMs: number;
}

/**
 * Build the only MySQL pool used by repositories.
 *
 * Every pooled connection is pinned to UTC before it is handed to a query.
 * The schema stores DATETIME values produced by FROM_UNIXTIME and compares
 * them with UTC_TIMESTAMP(), so a server-side local timezone would silently
 * shift every chart window and retention cutoff on an external database.
 */
export function createMysqlPool(uri: string, settings: MysqlPoolSettings): mysql.Pool {
  const pool = mysql.createPool({
    uri,
    waitForConnections: true,
    connectionLimit: settings.connectionLimit,
    queueLimit: settings.queueLimit,
    maxIdle: settings.connectionLimit,
    idleTimeout: settings.idleTimeoutMs,
    connectTimeout: settings.connectTimeoutMs,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,
    timezone: "Z"
  });
  pool.pool.on("connection", (connection) => {
    // Queued before the connection is handed to a repository query. Keep the
    // callback form because this is the core (non-promise) pool connection.
    connection.query("SET time_zone = '+00:00'", () => undefined);
  });
  return pool;
}

/** Fail early with an actionable message for unsupported external MySQL servers. */
export async function assertMysqlServerCompatibility(pool: mysql.Pool): Promise<{ version: string; timeZone: string }> {
  const connection = await pool.getConnection();
  let rows: mysql.RowDataPacket[];
  try {
    // Do not depend on the pool's connection event having completed before
    // the first user query on a freshly created pool.
    await connection.query("SET time_zone = '+00:00'");
    [rows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT VERSION() AS version, @@session.time_zone AS timeZone, DATABASE() AS databaseName"
    );
  } finally {
    connection.release();
  }
  const row = rows[0];
  const version = String(row?.version ?? "");
  const timeZone = String(row?.timeZone ?? "");
  const databaseName = String(row?.databaseName ?? "");
  if (!/^\d+\.\d+\.\d+/.test(version)) {
    throw new Error(`Unable to determine the MySQL server version (${version || "unknown"}).`);
  }
  if (version.toLowerCase().includes("mariadb")) {
    throw new Error(`MySQL 8.0 or newer is required; the server identifies as MariaDB (${version}).`);
  }
  const major = Number(version.split(".")[0]);
  if (major < 8) {
    throw new Error(`MySQL 8.0 or newer is required; the server reports ${version}.`);
  }
  if (!databaseName) {
    throw new Error("MYSQL_URL must select a database.");
  }
  // The connection listener sets UTC; this guard catches a pool/plugin that
  // skipped it rather than silently reading a shifted window.
  if (timeZone !== "+00:00" && timeZone !== "UTC") {
    throw new Error(`MySQL session time zone is ${timeZone}; expected +00:00.`);
  }
  return { version, timeZone };
}

export function queryOptions(sql: string, values: unknown[] | undefined, timeoutMs: number) {
  return values === undefined ? { sql, timeout: timeoutMs } : { sql, values, timeout: timeoutMs };
}
