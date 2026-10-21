import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const serverRoot = fileURLToPath(new URL("..", import.meta.url));

function loadProductionConfig(mysqlPassword: string) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "--eval", "import('./src/config.ts')"],
    {
      cwd: serverRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_ENV: "production",
        SESSION_SECRET: "stable-session-secret-for-config-tests-123456",
        ACCESS_KEY: "stable-access-key-123",
        REDIS_URL: "redis://:StrongRedisSecret_123456@127.0.0.1:6379",
        MYSQL_URL: `mysql://dsc:${mysqlPassword}@127.0.0.1:3306/device_state_console`,
        DSC_RELEASE_CHANNEL: "stable",
      },
    }
  );
}

test("stable production accepts a six-character MySQL application password", () => {
  const result = loadProductionConfig("654321");
  assert.equal(result.status, 0, result.stderr);
});

test("stable production continues to reject placeholder MySQL passwords", () => {
  const result = loadProductionConfig("change-me");
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /MYSQL_URL must contain a non-placeholder password with at least 6 characters/
  );
});
