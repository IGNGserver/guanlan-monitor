import assert from "node:assert/strict";
import test from "node:test";
import { createFallbackWindowMaterialCapabilities, resolveWindowMaterial } from "./window-material.ts";

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
