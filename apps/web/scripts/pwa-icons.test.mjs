import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const manifest = JSON.parse(fs.readFileSync(new URL("../public/manifest.json", import.meta.url), "utf8"));
const publicDir = new URL("../public/", import.meta.url);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readPng(file) {
  const buffer = fs.readFileSync(new URL(file, publicDir));
  assert.ok(buffer.subarray(0, 8).equals(PNG_SIGNATURE), `${file} is not a PNG`);
  assert.equal(buffer.toString("ascii", 12, 16), "IHDR", `${file} has no IHDR`);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer.readUInt8(24),
    colorType: buffer.readUInt8(25)
  };
}

test("manifest icons match their declared dimensions and stay opaque", () => {
  for (const icon of manifest.icons) {
    const [width, height] = icon.sizes.split("x").map(Number);
    const png = readPng(icon.src.replace(/^\//, ""));
    assert.equal(png.width, width, icon.src);
    assert.equal(png.height, height, icon.src);
    assert.equal(png.bitDepth, 8, icon.src);
    // Color type 2 is truecolor without an alpha channel. Safari uses an
    // opaque full-bleed bitmap for the macOS web app icon and rejects the
    // transparent rounded-corner artwork that used to live here.
    assert.equal(png.colorType, 2, `${icon.src} must be opaque RGB`);
  }

  const maskable1024 = manifest.icons.find((icon) => icon.sizes === "1024x1024" && icon.purpose.includes("maskable"));
  assert.ok(maskable1024, "Safari needs an opaque full-bleed 1024x1024 maskable icon");
  const any1024 = manifest.icons.find((icon) => icon.sizes === "1024x1024" && icon.purpose.includes("any"));
  assert.ok(any1024, "Safari needs a 1024x1024 any-purpose fallback");

  const apple = readPng("apple-touch-icon.png");
  assert.deepEqual([apple.width, apple.height, apple.colorType], [180, 180, 2]);
});
