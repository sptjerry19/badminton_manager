#!/usr/bin/env node
"use strict";
// Tạo database tạm trong Docker, không ghi dữ liệu vào nguồn.
require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { Client } = require("pg");
const { backup, restoreOrVerify } = require("./postgres-backup");

function docker(args) {
  try { return execFileSync("docker", args, { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"], timeout: 120000 }).trim(); }
  catch { throw new Error("Docker thất bại. Kiểm tra Docker đang chạy và image đã được tải."); }
}

async function main() {
  const image = process.env.POSTGRES_TOOLS_IMAGE;
  if (!image) throw new Error("Đặt POSTGRES_TOOLS_IMAGE đúng major của nguồn trước khi chạy.");
  const dir = path.resolve(__dirname, "..", "backups");
  const suffix = crypto.randomBytes(6).toString("hex");
  const name = "badminton-backup-drill-" + suffix;
  const database = "badminton_restore_" + suffix;
  const password = crypto.randomBytes(24).toString("hex");
  const previousPassword = process.env.POSTGRES_PASSWORD;
  const previousDb = process.env.POSTGRES_DB;
  const previousTarget = process.env.POSTGRES_RESTORE_URL;
  let created = false;
  const startedAt = new Date().toISOString();
  try {
    process.env.POSTGRES_PASSWORD = password;
    process.env.POSTGRES_DB = database;
    // tmpfs chứa database thử; dừng container sẽ xóa bản dữ liệu thử.
    docker(["run", "--rm", "--detach", "--name", name, "--publish", "127.0.0.1::5432",
      "--tmpfs", "/var/lib/postgresql/data", "-e", "POSTGRES_PASSWORD", "-e", "POSTGRES_DB", image]);
    created = true;
    const mapping = docker(["port", name, "5432/tcp"]);
    const port = mapping.match(/127\.0\.0\.1:(\d+)/)?.[1];
    if (!port) throw new Error("Không xác định được cổng database thử.");
    const url = "postgres://postgres:" + password + "@127.0.0.1:" + port + "/" + database + "?sslmode=disable";
    let ready = false;
    for (let i = 0; i < 40; i++) {
      const client = new Client({connectionString: url, connectionTimeoutMillis: 1000});
      client.on("error", () => {});
      try { await client.connect(); ready = true; }
      catch { /* startup */ }
      finally { await client.end().catch(() => {}); }
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!ready) throw new Error("Database thử chưa sẵn sàng.");
    const manifest = await backup(dir);
    const archive = path.join(dir, manifest.archive);
    process.env.POSTGRES_RESTORE_URL = url;
    const restored = await restoreOrVerify(archive, true);
    await restoreOrVerify(archive, false);
    // Bảo vệ trước khi ghi: đích có dữ liệu phải bị từ chối.
    let refused = false;
    try { await restoreOrVerify(archive, true); }
    catch (error) { refused = error.message.includes("không trống"); }
    if (!refused) throw new Error("Restore guard không từ chối đích có dữ liệu.");
    const report = {
      ...restored, startedAt, finishedAt: new Date().toISOString(), sourceServerVersion: manifest.serverVersion,
      repeatedRestoreRefused: refused,
      tables: manifest.tables.map(t => ({table: t.schema + "." + t.name, rows: t.rows, contentMatched: true})),
      scope: "Database dump and local restore. Roles/grants/server settings and offsite storage are outside this drill.",
    };
    const reportPath = archive + ".verification.json";
    await fs.promises.writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", {flag: "wx", mode: 0o600});
    console.log(JSON.stringify({ok: true, report: reportPath, tables: report.tables.length}));
  } finally {
    if (created) docker(["stop", "--time", "5", name]);
    for (const [key, value] of [["POSTGRES_PASSWORD", previousPassword], ["POSTGRES_DB", previousDb], ["POSTGRES_RESTORE_URL", previousTarget]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}
main().catch(() => {
  console.error("Backup drill thất bại. Xem bước thành công gần nhất; không công nhận backup đã kiểm chứng nếu thiếu report thành công.");
  process.exitCode = 1;
});
