import assert from "node:assert/strict";
import test from "node:test";
import { desktopUpdatePlatform } from "./platform.ts";

test("desktop update platforms never classify macOS as Linux", () => {
  assert.equal(desktopUpdatePlatform("darwin"), "macos-gui");
  assert.equal(desktopUpdatePlatform("win32"), "windows-gui");
  assert.equal(desktopUpdatePlatform("linux"), "linux-gui");
  assert.throws(() => desktopUpdatePlatform("freebsd"));
});
