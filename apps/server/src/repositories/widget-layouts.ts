import { randomUUID } from "node:crypto";
import mysql, { type PoolConnection, type RowDataPacket } from "mysql2/promise";
import type {
  WidgetLayoutDocument,
  WidgetLayoutSaveRequest,
  WidgetLayoutSync,
  WidgetLayoutTemplate
} from "@dsc/shared";
import type { WidgetLayoutStore } from "../types.js";
import { LocalWidgetLayoutStore, type LocalWidgetLayoutSnapshot } from "./local.js";

interface WidgetLayoutInstanceRow extends RowDataPacket {
  scope_key: string;
  template_key: string;
  updated_at: Date | string;
  layout_json: unknown;
}

interface WidgetLayoutTemplateRow extends RowDataPacket {
  template_key: string;
  template_id: string;
  name: string;
  created_at: Date | string;
  updated_at: Date | string;
  layout_json: unknown;
}

interface CountRow extends RowDataPacket {
  count: number;
}

function decodeLayout(value: unknown): WidgetLayoutDocument {
  if (Buffer.isBuffer(value)) return JSON.parse(value.toString("utf8")) as WidgetLayoutDocument;
  if (typeof value === "string") return JSON.parse(value) as WidgetLayoutDocument;
  if (!value || typeof value !== "object") throw new Error("invalid_widget_layout_json");
  return structuredClone(value as WidgetLayoutDocument);
}

function toIso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function toDate(value: string): Date {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export class MysqlWidgetLayoutStore implements WidgetLayoutStore {
  constructor(
    private readonly pool: mysql.Pool,
    private readonly legacyStore?: LocalWidgetLayoutStore
  ) {}

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS widget_layout_instances (
        scope_key VARCHAR(240) NOT NULL PRIMARY KEY,
        template_key VARCHAR(240) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        layout_json JSON NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS widget_layout_templates (
        template_key VARCHAR(240) NOT NULL,
        template_id VARCHAR(160) NOT NULL,
        name VARCHAR(80) NOT NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        layout_json JSON NOT NULL,
        PRIMARY KEY (template_key, template_id),
        INDEX idx_widget_layout_templates_updated_at (template_key, updated_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    if (this.legacyStore) await this.migrateLegacyIfEmpty();
  }

  async get(scopeKey: string, templateKey: string): Promise<WidgetLayoutSync> {
    const [instanceRows] = await this.pool.query<WidgetLayoutInstanceRow[]>(
      `
        SELECT scope_key, template_key, updated_at, layout_json
        FROM widget_layout_instances
        WHERE scope_key = ?
        LIMIT 1
      `,
      [scopeKey]
    );
    const [templateRows] = await this.pool.query<WidgetLayoutTemplateRow[]>(
      `
        SELECT template_key, template_id, name, created_at, updated_at, layout_json
        FROM widget_layout_templates
        WHERE template_key = ?
        ORDER BY updated_at DESC, template_id ASC
      `,
      [templateKey]
    );
    const instance = instanceRows[0];
    return {
      scopeKey,
      templateKey,
      instanceLayout: instance?.template_key === templateKey ? decodeLayout(instance.layout_json) : null,
      templates: templateRows.map((row) => ({
        id: row.template_id,
        name: row.name,
        templateKey: row.template_key,
        createdAt: toIso(row.created_at),
        updatedAt: toIso(row.updated_at),
        layout: decodeLayout(row.layout_json)
      } satisfies WidgetLayoutTemplate))
    };
  }

  async save(request: WidgetLayoutSaveRequest): Promise<WidgetLayoutSync> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      if (Object.prototype.hasOwnProperty.call(request, "instanceLayout")) {
        await this.saveInstance(
          connection,
          request.scopeKey,
          request.templateKey,
          request.instanceLayout ?? null
        );
      }
      if (request.linkedInstance) {
        await this.saveInstance(
          connection,
          request.linkedInstance.scopeKey,
          request.linkedInstance.templateKey,
          request.linkedInstance.instanceLayout
        );
      }
      if (request.template) {
        await connection.query(
          `
            INSERT INTO widget_layout_templates (
              template_key, template_id, name, created_at, updated_at, layout_json
            ) VALUES (?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), ?)
            ON DUPLICATE KEY UPDATE
              name = VALUES(name),
              updated_at = VALUES(updated_at),
              layout_json = VALUES(layout_json)
          `,
          [
            request.templateKey,
            request.template.id?.trim() || randomUUID(),
            request.template.name.trim(),
            JSON.stringify(request.template.layout)
          ]
        );
      }
      if (request.deleteTemplateId) {
        await connection.query(
          `
            DELETE FROM widget_layout_templates
            WHERE template_key = ? AND template_id = ?
          `,
          [request.templateKey, request.deleteTemplateId]
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
    return this.get(request.scopeKey, request.templateKey);
  }

  private async saveInstance(
    connection: PoolConnection,
    scopeKey: string,
    templateKey: string,
    instanceLayout: WidgetLayoutDocument | null
  ): Promise<void> {
    if (instanceLayout === null) {
      await connection.query(
        "DELETE FROM widget_layout_instances WHERE scope_key = ?",
        [scopeKey]
      );
      return;
    }
    await connection.query(
      `
        INSERT INTO widget_layout_instances (scope_key, template_key, updated_at, layout_json)
        VALUES (?, ?, UTC_TIMESTAMP(3), ?)
        ON DUPLICATE KEY UPDATE
          template_key = VALUES(template_key),
          updated_at = VALUES(updated_at),
          layout_json = VALUES(layout_json)
      `,
      [scopeKey, templateKey, JSON.stringify(instanceLayout)]
    );
  }

  private async migrateLegacyIfEmpty(): Promise<void> {
    const [instanceCountRows] = await this.pool.query<CountRow[]>(
      "SELECT COUNT(*) AS count FROM widget_layout_instances"
    );
    const [templateCountRows] = await this.pool.query<CountRow[]>(
      "SELECT COUNT(*) AS count FROM widget_layout_templates"
    );
    if (Number(instanceCountRows[0]?.count ?? 0) > 0 || Number(templateCountRows[0]?.count ?? 0) > 0) return;

    const legacy = await this.legacyStore?.readAll();
    if (!legacy || (!Object.keys(legacy.instances).length && !Object.keys(legacy.templates).length)) return;

    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await this.importLegacy(connection, legacy);
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }

  private async importLegacy(connection: PoolConnection, legacy: LocalWidgetLayoutSnapshot): Promise<void> {
    for (const [scopeKey, instance] of Object.entries(legacy.instances)) {
      await connection.query(
        `
          INSERT INTO widget_layout_instances (scope_key, template_key, updated_at, layout_json)
          VALUES (?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            template_key = VALUES(template_key),
            updated_at = VALUES(updated_at),
            layout_json = VALUES(layout_json)
        `,
        [scopeKey, instance.templateKey, toDate(instance.updatedAt), JSON.stringify(instance.layout)]
      );
    }
    for (const [templateKey, templates] of Object.entries(legacy.templates)) {
      for (const template of Object.values(templates)) {
        await connection.query(
          `
            INSERT INTO widget_layout_templates (
              template_key, template_id, name, created_at, updated_at, layout_json
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              name = VALUES(name),
              updated_at = VALUES(updated_at),
              layout_json = VALUES(layout_json)
          `,
          [
            templateKey,
            template.id,
            template.name,
            toDate(template.createdAt),
            toDate(template.updatedAt),
            JSON.stringify(template.layout)
          ]
        );
      }
    }
  }
}
