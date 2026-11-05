"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const DIRECTORY = path.resolve(__dirname,"../../migrations");

function loadMigrations(directory = DIRECTORY) {
  const names = fs.readdirSync(directory).filter(name=>name.endsWith(".sql")).sort();
  const versions = new Set();
  const migrations = names.map(name=>{
    const match = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(name);
    if (!match || versions.has(match[1])) throw new Error("Tên hoặc phiên bản migration không hợp lệ: " + name);
    versions.add(match[1]);
    const sql = fs.readFileSync(path.join(directory,name),"utf8").replace(/\r\n/g,"\n");
    return {name,sql,checksum:crypto.createHash("sha256").update(sql).digest("hex")};
  });
  if (!migrations.length) throw new Error("Không có migration để kiểm tra.");
  return migrations;
}
function reconcile(migrations,applied) {
  const local = new Map(migrations.map(m=>[m.name,m]));
  for (const row of applied) {
    if (!local.has(row.name)) throw new Error("Thiếu file migration đã áp dụng: " + row.name);
    if (local.get(row.name).checksum !== row.checksum) throw new Error("Checksum migration đã thay đổi: " + row.name);
  }
  const names = new Set(applied.map(row=>row.name));
  const latest = applied.map(row=>row.name).sort().at(-1);
  const pending = migrations.filter(m=>!names.has(m.name));
  if (latest && pending.some(m=>m.name < latest)) throw new Error("Migration mới phải có phiên bản lớn hơn phiên bản đã áp dụng.");
  return pending;
}
async function migrationStatus(pool,{directory = DIRECTORY} = {}) {
  const migrations = loadMigrations(directory);
  const exists = (await pool.query("SELECT to_regclass('public.schema_migrations') AS name")).rows[0].name;
  const applied = exists ? (await pool.query("SELECT name,checksum,applied_at FROM public.schema_migrations ORDER BY name")).rows : [];
  return {applied,pending:reconcile(migrations,applied).map(m=>m.name)};
}
async function assertMigrationsCurrent(pool,options) {
  const status = await migrationStatus(pool,options);
  if (status.pending.length) throw new Error("Database chưa cập nhật. Chạy npm run db:migrate trước khi khởi động: " + status.pending.join(", "));
  return status;
}
async function runMigrations(pool,{directory = DIRECTORY} = {}) {
  const migrations = loadMigrations(directory);
  const client = await pool.connect();
  let current;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '15s'");
    await client.query("SET LOCAL statement_timeout = '120s'");
    await client.query("SET LOCAL search_path = public, pg_catalog");
    await client.query("SELECT pg_advisory_xact_lock(719513883)");
    await client.query("CREATE TABLE IF NOT EXISTS public.schema_migrations(name TEXT PRIMARY KEY,checksum TEXT NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
    const applied = (await client.query("SELECT name,checksum FROM public.schema_migrations ORDER BY name")).rows;
    const pending = reconcile(migrations,applied);
    for (const migration of pending) {
      current = migration.name;
      await client.query(migration.sql);
      await client.query("INSERT INTO public.schema_migrations(name,checksum) VALUES ($1,$2)",[migration.name,migration.checksum]);
    }
    await client.query("COMMIT");
    return {applied:pending.map(m=>m.name)};
  } catch (error) {
    await client.query("ROLLBACK").catch(()=>{});
    if (error.code) throw new Error("Migration " + (current || "setup") + " thất bại (SQLSTATE " + error.code + "). Đã rollback; không tự sửa/xóa dữ liệu cũ.");
    throw error;
  } finally {client.release();}
}
module.exports = {loadMigrations,reconcile,migrationStatus,assertMigrationsCurrent,runMigrations};
