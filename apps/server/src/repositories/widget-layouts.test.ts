import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WidgetLayoutDocument } from "@dsc/shared";
import { createLocalStore, LocalWidgetLayoutStore } from "./local.ts";

function layout(panels?: WidgetLayoutDocument["panels"]): WidgetLayoutDocument {
  return {
    version: 4,
    placements: {},
    catalog: {},
    snapToGrid: true,
    ...(panels ? { panels } : {})
  };
}

test("local widget layout store atomically persists linked panel mutations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dsc-widget-layout-"));
  const filePath = join(directory, "local-db.json");
  const indexScope = "device:workstation:panel-index";
  const indexTemplate = "device-type:device:panel-index";
  const panelScope = "device:workstation:panel:panel-custom";
  const panelTemplate = "device-type:device:panel";
  const panel = { id: "panel-custom", name: "自定义面板", kind: "custom" as const, order: 5 };
  const indexLayout = layout([panel]);
  const panelLayout = layout();

  try {
    const store = new LocalWidgetLayoutStore(createLocalStore(filePath));
    await store.save({
      scopeKey: indexScope,
      templateKey: indexTemplate,
      instanceLayout: indexLayout,
      linkedInstance: {
        scopeKey: panelScope,
        templateKey: panelTemplate,
        instanceLayout: panelLayout
      }
    });

    const reloaded = new LocalWidgetLayoutStore(createLocalStore(filePath));
    assert.deepStrictEqual(
      (await reloaded.get(indexScope, indexTemplate)).instanceLayout,
      indexLayout
    );
    assert.deepStrictEqual(
      (await reloaded.get(panelScope, panelTemplate)).instanceLayout,
      panelLayout
    );

    await reloaded.save({
      scopeKey: indexScope,
      templateKey: indexTemplate,
      instanceLayout: layout(),
      linkedInstance: {
        scopeKey: panelScope,
        templateKey: panelTemplate,
        instanceLayout: null
      }
    });

    assert.strictEqual((await reloaded.get(panelScope, panelTemplate)).instanceLayout, null);
    assert.deepStrictEqual(
      (await reloaded.get(indexScope, indexTemplate)).instanceLayout,
      layout()
    );

    const persisted = JSON.parse(await readFile(filePath, "utf8")) as {
      widgetLayouts?: { instances?: Record<string, unknown> };
    };
    const instances = persisted.widgetLayouts?.instances;
    assert.ok(instances);
    assert.ok(!instances[panelScope]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
