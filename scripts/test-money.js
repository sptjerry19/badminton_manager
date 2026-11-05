#!/usr/bin/env node
"use strict";
// Không nạp .env: runner tự tạo DB riêng, không nhận URL database từ bên ngoài.
const crypto = require("node:crypto");
const { execFileSync, spawn } = require("node:child_process");
const path = require("node:path");
const { Client } = require("pg");

function docker(args, env) {
  try {
    return execFileSync("docker", args, {env, encoding: "utf8", windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"], timeout: 60000}).trim();
  } catch {
    throw new Error("Không chạy được Docker. Cần Docker đang chạy và image postgres:17 đã tải (docker pull postgres:17).");
  }
}

async function main() {
  const suffix = crypto.randomBytes(6).toString("hex");
  const name = "badminton-money-tests-" + suffix;
  const database = "badminton_money_test_" + suffix;
  const password = crypto.randomBytes(24).toString("hex");
  const env = {...process.env};
  for (const key of Object.keys(env)) if (/^(PG|POSTGRES|MONEY_TEST)/.test(key)) delete env[key];
  const dockerEnv = {...env, POSTGRES_PASSWORD: password, POSTGRES_DB: database};
  let created = false;
  try {
    docker(["image", "inspect", "postgres:17"], dockerEnv);
    docker(["run", "--pull=never", "--rm", "--detach", "--name", name,
      "--publish", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql/data",
      "-e", "POSTGRES_PASSWORD", "-e", "POSTGRES_DB", "postgres:17"], dockerEnv);
    created = true;
    const port = docker(["port", name, "5432/tcp"], dockerEnv).match(/127\.0\.0\.1:(\d+)/)?.[1];
    if (!port) throw new Error("Không xác định được cổng DB kiểm thử.");
    const url = "postgres://postgres:" + password + "@localhost:" + port + "/" + database + "?sslmode=disable";
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      const client = new Client({connectionString: url, connectionTimeoutMillis: 1000});
      client.on("error", () => {});
      try { await client.connect(); ready = true; }
      catch { /* PostgreSQL đang khởi động. */ }
      finally { await client.end().catch(() => {}); }
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!ready) throw new Error("DB kiểm thử chưa sẵn sàng.");
    Object.assign(env, {POSTGRES_URL: url, MONEY_TEST_URL: url, PGAPPNAME: "badminton-money-" + suffix, NODE_ENV: "test", VERCEL: "0"});
    const files = ["tests/money.integration.test.js"];
    if (process.argv.includes("--all")) files.unshift("scripts/postgres-backup.test.js", "tests/credit-form.test.js", "tests/business-time.test.js", "tests/runtime-config.test.js", "tests/migrations.integration.test.js");
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--test", "--test-concurrency=1", ...files], {
        cwd: path.resolve(__dirname, ".."), env, stdio: "inherit", windowsHide: true,
      });
      child.on("error", reject);
      child.on("exit", code => resolve(code ?? 1));
    });
    process.exitCode = code;
  } finally {
    if (created) {
      docker(["stop", "--time", "5", name], dockerEnv);
      console.log("Đã dọn database Docker kiểm thử.");
    }
  }
}
main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
