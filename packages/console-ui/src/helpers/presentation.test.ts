import assert from "node:assert/strict";
import test from "node:test";
import { resolveWebPresentation, supportsTouchSplit, type PresentationInput } from "./presentation.ts";
const desktop: PresentationInput = { width: 1366, height: 900, screenShortSide: 900, hasTouch: false, coarsePointer: false, userAgent: "Windows", preference: "auto", native: false };
test("phone identity survives rotation and external input", () => {
  assert.equal(resolveWebPresentation({ ...desktop, width: 390, screenShortSide: 390, hasTouch: true, coarsePointer: true, userAgent: "iPhone Mobile" }), "phone");
  assert.equal(resolveWebPresentation({ ...desktop, width: 844, height: 390, screenShortSide: 390, hasTouch: true, userAgent: "iPhone Mobile" }), "phone");
  assert.equal(resolveWebPresentation({ ...desktop, userAgent: "iPhone Mobile" }), "phone");
  assert.equal(supportsTouchSplit("phone", 1024), false);
});
test("tablet identity survives split-screen and trackpad; columns use available width", () => {
  assert.equal(resolveWebPresentation({ ...desktop, width: 430, screenShortSide: 834, hasTouch: true, userAgent: "Macintosh" }), "tablet");
  assert.equal(resolveWebPresentation({ ...desktop, hasTouch: true, userAgent: "iPad" }), "tablet");
  // Safari's desktop-style iPad UA retains Mobile even when the touch API
  // is unavailable; a narrow split window must still use the tablet shell.
  assert.equal(resolveWebPresentation({ ...desktop, width: 430, screenShortSide: 430, coarsePointer: true, userAgent: "Macintosh Mobile/15E148 Safari" }), "tablet");
  assert.equal(resolveWebPresentation({ ...desktop, userAgent: "Macintosh Mobile/15E148 Safari" }), "tablet");
  assert.equal(resolveWebPresentation({ ...desktop, userAgent: "Macintosh Safari" }), "desktop");
  assert.equal(resolveWebPresentation({ ...desktop, width: 430, screenShortSide: 834, hasTouch: true, coarsePointer: true, userAgent: "Linux x86_64 Chrome" }), "tablet");
  assert.equal(supportsTouchSplit("tablet", 839), false);
  assert.equal(supportsTouchSplit("tablet", 840), true);
});
test("capabilities, native boundary and explicit layout choice override UA hints", () => {
  assert.equal(resolveWebPresentation(desktop), "desktop");
  assert.equal(resolveWebPresentation({ ...desktop, hasTouch: true }), "desktop");
  assert.equal(resolveWebPresentation({ ...desktop, coarsePointer: true }), "tablet");
  assert.equal(resolveWebPresentation({ ...desktop, width: 360, screenShortSide: 360 }), "phone");
  assert.equal(resolveWebPresentation({ ...desktop, preference: "touch" }), "tablet");
  assert.equal(resolveWebPresentation({ ...desktop, preference: "desktop", coarsePointer: true }), "desktop");
  assert.equal(resolveWebPresentation({ ...desktop, native: true, coarsePointer: true, preference: "touch" }), "desktop");
});
test("a compact width has one layout for every client", () => {
  // The browser's "desktop" choice and narrow native windows used to get the
  // desktop shell's own phone mode; compact widths now always use the touch shell.
  assert.equal(resolveWebPresentation({ ...desktop, width: 360, userAgent: "iPhone", preference: "desktop" }), "phone");
  assert.equal(resolveWebPresentation({ ...desktop, width: 390, screenShortSide: 1080, native: true }), "phone");
  assert.equal(resolveWebPresentation({ ...desktop, width: 700, screenShortSide: 1080, native: true }), "tablet");
  assert.equal(resolveWebPresentation({ ...desktop, width: 839, native: true }), "tablet");
  assert.equal(resolveWebPresentation({ ...desktop, width: 840, native: true }), "desktop");
});
