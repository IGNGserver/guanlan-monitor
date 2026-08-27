import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { isTrustedRendererUrl } from "./renderer-security.js";

const rendererRoot = "/opt/device-state-console/dist/renderer";

test("accepts only the packaged renderer file subtree", () => {
  assert.equal(
    isTrustedRendererUrl(pathToFileURL(rendererRoot + "/index.html").toString(), rendererRoot),
    true
  );
  assert.equal(
    isTrustedRendererUrl(pathToFileURL(rendererRoot + "/assets/app.js").toString(), rendererRoot),
    true
  );
  assert.equal(
    isTrustedRendererUrl(pathToFileURL("/opt/device-state-console/dist/main.js").toString(), rendererRoot),
    false
  );
});

test("accepts only the configured development origin and explicit recovery page", () => {
  assert.equal(
    isTrustedRendererUrl("http://127.0.0.1:5173/index.html", rendererRoot, "http://127.0.0.1:5173"),
    true
  );
  assert.equal(
    isTrustedRendererUrl("http://127.0.0.1:5174/index.html", rendererRoot, "http://127.0.0.1:5173"),
    false
  );
  assert.equal(
    isTrustedRendererUrl("data:text/html;charset=utf-8,<h1>recovery</h1>", rendererRoot, undefined),
    false
  );
  assert.equal(
    isTrustedRendererUrl("data:text/html;charset=utf-8,<h1>recovery</h1>", rendererRoot, undefined, true),
    true
  );
});
