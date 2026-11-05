"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { connection, assertRestoreTarget, pgEnvironment, compare } = require("./postgres-backup");

test("reject missing database and non-Postgres URLs", () => {
  assert.throws(() => connection(""));
  assert.throws(() => connection("https://example.com/app"));
  assert.throws(() => connection("postgres://localhost/"));
});
test("restore rejects production names and same source name even via another hostname", () => {
  assert.throws(() => assertRestoreTarget("postgres://localhost/app", "app"));
  assert.throws(() => assertRestoreTarget("postgres://alias/badminton_restore_test", "badminton_restore_test"));
  assert.equal(assertRestoreTarget("postgres://localhost/badminton_restore_test", "app"), "badminton_restore_test");
});
test("credentials stay in environment; Docker localhost is mapped explicitly", () => {
  const env = pgEnvironment("postgres://user:p%40ss@localhost:5433/app?sslmode=require", true);
  assert.equal(env.PGPASSWORD, "p@ss");
  assert.equal(env.PGHOST, "host.docker.internal");
  assert.equal(env.PGPORT, "5433");
  assert.equal(env.PGSSLMODE, "require");
});
test("reject unhandled connection options and local certificate paths in Docker", () => {
  assert.throws(() => pgEnvironment("postgres://localhost/app?unknown=true"));
  assert.throws(() => pgEnvironment("postgres://localhost/app?sslrootcert=local.pem", true));
});
test("verification detects modified rows even when counts match and extra/missing tables", () => {
  const row = {schema: "public", name: "basic_shares", rows: "2", hash_a: "10", hash_b: "20", columns: []};
  compare([row], [{...row}]);
  assert.throws(() => compare([row], [{...row, hash_a: "11"}]), /basic_shares/);
  assert.throws(() => compare([row], []), /basic_shares/);
  assert.throws(() => compare([], [row]), /basic_shares/);
});

test("Neon pooled source resolves to the documented direct endpoint", () => {
  const { sourceUrl } = require("./postgres-backup");
  const previous = process.env.POSTGRES_BACKUP_URL;
  try {
    process.env.POSTGRES_BACKUP_URL = "postgres://u:p@ep-test-pooler.region.aws.neon.tech/app?sslmode=require";
    assert.equal(new URL(sourceUrl()).hostname, "ep-test.region.aws.neon.tech");
    process.env.POSTGRES_BACKUP_URL = "postgres://u:p@other-pooler.example/app";
    assert.throws(() => sourceUrl(), /pooler/);
  } finally {
    if (previous === undefined) delete process.env.POSTGRES_BACKUP_URL;
    else process.env.POSTGRES_BACKUP_URL = previous;
  }
});
