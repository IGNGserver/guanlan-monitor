import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const serverRoot = fileURLToPath(new URL("..", import.meta.url));

function loadConfig(overrides: Record<string, string | undefined>) {
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
        MYSQL_URL: "mysql://dsc:StrongDatabaseSecret_123456@127.0.0.1:3306/device_state_console",
        DSC_RELEASE_CHANNEL: "stable",
        ...overrides
      },
    }
  );
}

function loadProductionConfig(mysqlPassword: string) {
  return loadConfig({ MYSQL_URL: `mysql://dsc:${mysqlPassword}@127.0.0.1:3306/device_state_console` });
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

test("external mode requires both database URLs and a unique instance id", () => {
  const missingUrl = loadConfig({ DSC_DB_MODE: "external", MYSQL_URL: undefined, DSC_INSTANCE_ID: "hub-home" });
  assert.notEqual(missingUrl.status, 0);
  assert.match(missingUrl.stderr, /DSC_DB_MODE=external requires both MYSQL_URL and REDIS_URL/);

  const defaultInstance = loadConfig({ DSC_DB_MODE: "external" });
  assert.notEqual(defaultInstance.status, 0);
  assert.match(defaultInstance.stderr, /requires a unique DSC_INSTANCE_ID/);
});

test("production refuses to silently fall back to local storage", () => {
  const result = loadConfig({ MYSQL_URL: undefined, REDIS_URL: undefined });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Production requires MYSQL_URL and REDIS_URL/);
});

test("production can explicitly allow a local-only deployment", () => {
  const result = loadConfig({ MYSQL_URL: undefined, REDIS_URL: undefined, DSC_ALLOW_LOCAL_FALLBACK: "true" });
  assert.equal(result.status, 0, result.stderr);
});

test("instance id and Redis TLS URLs are accepted; unsafe MySQL options are rejected", () => {
  const accepted = loadConfig({
    DSC_DB_MODE: "external",
    DSC_INSTANCE_ID: "hub-home_1",
    REDIS_URL: "rediss://:StrongRedisSecret_123456@redis.example.com:6379/3",
    MYSQL_URL: "mysql://dsc:StrongDatabaseSecret_123456@db.example.com:3306/guanlan_home"
  });
  assert.equal(accepted.status, 0, accepted.stderr);

  const badInstance = loadConfig({ DSC_INSTANCE_ID: "../escape" });
  assert.notEqual(badInstance.status, 0);
  assert.match(badInstance.stderr, /DSC_INSTANCE_ID/);

  const unsafeUrl = loadConfig({
    MYSQL_URL: "mysql://dsc:StrongDatabaseSecret_123456@db.example.com:3306/guanlan_home?multipleStatements=true"
  });
  assert.notEqual(unsafeUrl.status, 0);
  assert.match(unsafeUrl.stderr, /must not set the multipleStatements option/);
});
