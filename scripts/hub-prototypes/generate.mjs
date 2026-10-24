import { readFile, writeFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { pathToFileURL } from "node:url";

// The repository fixture has type-only imports; no third-party loader is needed.
export async function generateBatch(count = 64, fixture = new URL("../../apps/server/src/hub-contract-fixtures.ts", import.meta.url)) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 100_000) throw new RangeError("count: 1..100000");
  const source = stripTypeScriptTypes(await readFile(fixture, "utf8"), { mode: "strip" });
  const { createHubContractPayload, HUB_CONTRACT_TIMESTAMP } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  const epoch = Date.parse(HUB_CONTRACT_TIMESTAMP);
  const batch = Array.from({ length: count }, (_, index) => {
    const payload = createHubContractPayload({
      deviceId: `prototype-${String(index % 4).padStart(2, "0")}`,
      timestamp: epoch + Math.floor(index / 4) * 1000
    });
    payload.cpuUsagePercent = index % 101;
    payload.prototypeUnknown = { text: "未知<&>\u2028", nested: [null, false, 0, -0, 1.25, 1e-7, Number.MAX_SAFE_INTEGER], sequence: index };
    payload.identity.prototypeUnknown = "preserve me";
    return payload;
  });
  // Deliberate out-of-order replay with a changed metric and unknown metadata.
  const replay = structuredClone(batch[0]);
  replay.cpuUsagePercent = 99;
  replay.prototypeUnknown.replacement = true;
  batch.push(replay);
  return batch;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [output, count = "64", fixture] = process.argv.slice(2);
  if (!output) throw new Error("usage: node generate.mjs OUTPUT [COUNT] [FIXTURE.ts]");
  await writeFile(output, JSON.stringify(await generateBatch(Number(count), fixture)));
}
