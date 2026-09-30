import test from "node:test";
import assert from "node:assert/strict";
import { CAPTION_GLYPHS, captionGlyphFor, isCaptionIcon, type CaptionGlyphName } from "./captionGlyphs.ts";

const names: CaptionGlyphName[] = ["minimize", "maximize", "restore", "close"];

test("every caption glyph is defined and non-empty", () => {
  for (const name of names) {
    assert.equal(typeof CAPTION_GLYPHS[name], "string", `${name} glyph is missing`);
    assert.ok(CAPTION_GLYPHS[name].length > 0, `${name} glyph is empty`);
  }
});

// The maximize button used to render `Maximize` for both states, so the control
// never changed appearance when the window was restored. Distinct path data is
// what makes the button tell the truth; identity here would silently restore
// that bug.
test("maximize and restore are visually distinct glyphs", () => {
  assert.notEqual(CAPTION_GLYPHS.maximize, CAPTION_GLYPHS.restore);
});

test("no two caption glyphs share path data", () => {
  const seen = new Map<string, CaptionGlyphName>();
  for (const name of names) {
    const existing = seen.get(CAPTION_GLYPHS[name]);
    assert.equal(existing, undefined, `${name} duplicates the ${existing} glyph`);
    seen.set(CAPTION_GLYPHS[name], name);
  }
});

test("the icon-name mapping points each chrome name at a distinct glyph", () => {
  assert.equal(captionGlyphFor("windowMinimize"), "minimize");
  assert.equal(captionGlyphFor("windowMaximize"), "maximize");
  assert.equal(captionGlyphFor("windowRestore"), "restore");
  assert.equal(captionGlyphFor("windowClose"), "close");
  // The bug this file exists for: "windowRestore" resolved to the maximize
  // square, so entering and leaving fullscreen drew the same icon.
  assert.notEqual(captionGlyphFor("windowRestore"), captionGlyphFor("windowMaximize"));
});

test("only the four chrome names are treated as caption icons", () => {
  for (const name of ["windowMinimize", "windowMaximize", "windowRestore", "windowClose"]) {
    assert.equal(isCaptionIcon(name), true, `${name} should map to a caption glyph`);
  }
  for (const name of ["overview", "settings", "refresh", "chevron", "delete", "constructor", "toString", ""]) {
    assert.equal(isCaptionIcon(name), false, `${name} must fall through to the shared icon map`);
  }
});

// The glyphs are authored on the 10x10 box the caption button renders into, so
// a path with an out-of-range coordinate would be clipped in the browser but
// still pass a "non-empty string" check.
test("caption glyph coordinates stay inside the 10x10 viewBox", () => {
  for (const name of names) {
    const coordinates = CAPTION_GLYPHS[name].match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    assert.ok(coordinates.length >= 2, `${name} glyph has no coordinates`);
    for (const value of coordinates) {
      assert.ok(value >= -0.5 && value <= 10.5, `${name} glyph coordinate ${value} leaves the 10x10 box`);
    }
  }
});
