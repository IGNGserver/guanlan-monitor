import assert from "node:assert/strict";
import test from "node:test";
import { createFallbackWindowMaterialCapabilities, parseWindowMaterialArgument, resolveWindowMaterial } from "./window-material.ts";

test("Windows 11 resolves to native Mica when transparency is available", () => {
  assert.equal(resolveWindowMaterial({
    platform: "windows",
    windowsBuild: 22621,
    prefersReducedTransparency: false,
    supportsNativeMaterial: true
  }), "mica");
});

test("Windows 10 and older Windows builds use the opaque fallback", () => {
  for (const windowsBuild of [19045, 22000]) {
    assert.equal(resolveWindowMaterial({
      platform: "windows",
      windowsBuild,
      prefersReducedTransparency: false,
      supportsNativeMaterial: true
    }), "opaque");
  }
});

test("reduced transparency and unavailable native support always use opaque surfaces", () => {
  assert.equal(resolveWindowMaterial({
    platform: "windows",
    windowsBuild: 22631,
    prefersReducedTransparency: true,
    supportsNativeMaterial: true
  }), "opaque");
  assert.equal(resolveWindowMaterial({
    platform: "windows",
    windowsBuild: 22631,
    prefersReducedTransparency: false,
    supportsNativeMaterial: false
  }), "opaque");
  assert.equal(resolveWindowMaterial({
    platform: "other",
    windowsBuild: null,
    prefersReducedTransparency: false,
    supportsNativeMaterial: false
  }), "opaque");
});

test("fallback capabilities never expose a user-selectable material", () => {
  assert.deepEqual(createFallbackWindowMaterialCapabilities(), {
    platform: "other",
    windowsBuild: null,
    supportsMica: false,
    prefersReducedTransparency: false,
    activeMaterial: "opaque"
  });
});

/**
 * The renderer reads the material from a launch switch so its first paint is
 * already correct. The switch has to be parsed strictly: defaulting to "mica"
 * on an unparseable value would leave a transparent window on a system with no
 * backdrop behind it, which is worse than a one-frame opaque paint.
 */
test("the launch switch only ever yields opaque or mica", () => {
  assert.equal(parseWindowMaterialArgument(["--dsc-window-material=mica"]), "mica");
  assert.equal(parseWindowMaterialArgument(["--dsc-window-material=opaque"]), "opaque");
  assert.equal(parseWindowMaterialArgument([]), "opaque", "a missing switch means opaque");
  assert.equal(parseWindowMaterialArgument(["--dsc-window-material="]), "opaque");
  assert.equal(parseWindowMaterialArgument(["--dsc-window-material=MICA"]), "opaque", "the value is case-sensitive");
  assert.equal(parseWindowMaterialArgument(["--other=mica"]), "opaque", "an unrelated switch must not be read as the material");
  assert.equal(parseWindowMaterialArgument(["--dsc-window-material=mica", "--dsc-window-material=opaque"]), "mica", "the first match wins");
});
