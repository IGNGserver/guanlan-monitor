import assert from "node:assert/strict";
import test from "node:test";
import { hubRequestHeaders } from "./hub-request-headers.ts";

test("a bodyless Hub request never declares a JSON body", () => {
  // The Hub answers 400 to a declared content type on an empty body before the route runs, which
  // is exactly how deleting a device used to fail.
  const headers = hubRequestHeaders({ method: "DELETE" });
  assert.equal(headers.Accept, "application/json");
  assert.equal("Content-Type" in headers, false);
});

test("a Hub request with a body declares JSON", () => {
  const headers = hubRequestHeaders({ method: "PUT", body: JSON.stringify({ deviceId: "next" }) });
  assert.equal(headers["Content-Type"], "application/json");
});

test("caller headers are still merged over the defaults", () => {
  const headers = hubRequestHeaders({ method: "GET", headers: { "If-None-Match": "abc" } });
  assert.equal(headers["If-None-Match"], "abc");
  assert.equal(headers.Accept, "application/json");
});
