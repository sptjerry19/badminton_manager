#!/usr/bin/env node
"use strict";

require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { pipeline } = require("node:stream/promises");
const { Client } = require("pg");

const ROOT = path.resolve(__dirname, "..");
const quote = (name) => '"' + String(name).replace(/"/g, '""') + '"';

function connection(url) {
  if (!url) throw new Error("Thiếu URL database trong biến môi trường.");
  const parsed = new URL(url);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new Error("URL phải là PostgreSQL.");
  if (!parsed.pathname.slice(1)) throw new Error("URL phải chỉ rõ tên database.");
  return parsed;
}

function assertRestoreTarget(url, sourceDatabase) {
  const parsed = connection(url);
  const name = decodeURIComponent(parsed.pathname.slice(1));
  if (!/^badminton_restore_[a-z0-9_]+$/.test(name)) {
    throw new Error("Database đích phải có tên badminton_restore_<tên_kiểm_thử>.");
  }
  if (name === sourceDatabase) throw new Error("Database đích trùng tên database nguồn.");
  return name;
}

function pgEnvironment(url, docker = false) {
  const parsed = connection(url);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  const env = { ...process.env };
  // Không để các PG* của shell vô tình chuyển kết nối sang database khác.
  for (const key of Object.keys(env)) if (key.startsWith("PG")) delete env[key];
  Object.assign(env, {
    PGHOST: docker && ["localhost", "127.0.0.1", "::1"].includes(hostname) ? "host.docker.internal" : hostname,
    PGPORT: parsed.port || "5432",
    PGDATABASE: decodeURIComponent(parsed.pathname.slice(1)),
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGCONNECT_TIMEOUT: "15",
    PGAPPNAME: "badminton-backup",
  });
  const supported = { sslmode: "PGSSLMODE", sslrootcert: "PGSSLROOTCERT", sslcert: "PGSSLCERT", sslkey: "PGSSLKEY", options: "PGOPTIONS", channel_binding: "PGCHANNELBINDING" };
  for (const [key, value] of parsed.searchParams) {
    if (!supported[key]) throw new Error("Tham số URL không hỗ trợ: " + key + ". Dùng URL kết nối trực tiếp.");
    if (docker && ["sslrootcert", "sslcert", "sslkey"].includes(key)) {
      throw new Error("Chứng chỉ file local yêu cầu công cụ Postgres native (PG_BIN_DIR).");
    }
    env[supported[key]] = value;
  }
  return env;
}

async function connect(url) {
  connection(url);
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 15000, query_timeout: 120000 });
  client.on("error", () => {}); // Lỗi truy vấn vẫn được trả cho caller; không in URL/credentials.
  try { await client.connect(); return client; }
  catch (error) { await client.end().catch(() => {}); throw error; }
}

async function inventory(client) {
  const tables = (await client.query(`
    SELECT n.nspname AS schema, c.relname AS name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p') AND n.nspname <> 'information_schema'
      AND n.nspname !~ '^pg_'
    ORDER BY n.nspname, c.relname
  `)).rows;
  for (const table of tables) {
    table.columns = (await client.query(`
      SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
             a.attnotnull AS not_null, a.attidentity AS identity, a.attgenerated AS generated
      FROM pg_attribute a
      WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum
    `, [quote(table.schema) + "." + quote(table.name)])).rows;
    // Cùng snapshot với pg_dump. Hai tổng hash không phụ thuộc thứ tự hàng.
    const data = await client.query(`
      SELECT COUNT(*)::text AS rows,
        COALESCE(SUM(('x' || substr(md5(row_to_json(t)::text), 1, 16))::bit(64)::bigint::numeric), 0)::text AS hash_a,
        COALESCE(SUM(('x' || substr(md5(row_to_json(t)::text), 17, 16))::bit(64)::bigint::numeric), 0)::text AS hash_b
      FROM ${quote(table.schema)}.${quote(table.name)} t
    `);
    Object.assign(table, data.rows[0]);
  }
  return tables;
}

function compare(expected, actual) {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    const byName = new Map(actual.map(t => [t.schema + "." + t.name, t]));
    const different = expected.filter(t => JSON.stringify(t) !== JSON.stringify(byName.get(t.schema + "." + t.name)))
      .map(t => t.schema + "." + t.name);
    for (const t of actual) if (!expected.some(e => e.schema === t.schema && e.name === t.name)) different.push(t.schema + "." + t.name);
    throw new Error("Đối chiếu không khớp: " + different.join(", "));
  }
}

async function tool(name, args, url, inputFile, outputFile) {
  const docker = Boolean(process.env.POSTGRES_TOOLS_IMAGE);
  const env = pgEnvironment(url, docker);
  let executable = process.env.PG_BIN_DIR ? path.join(process.env.PG_BIN_DIR, name + (process.platform === "win32" ? ".exe" : "")) : name;
  if (docker) {
    executable = "docker";
    args = ["run", "--rm", "-i", ...Object.keys(env).filter(k => k.startsWith("PG")).flatMap(k => ["-e", k]),
      process.env.POSTGRES_TOOLS_IMAGE, name, ...args];
  }
  const child = spawn(executable, args, { env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  // Không xuất stderr của client vì có thể chứa thông tin kết nối hoặc dữ liệu.
  child.stderr.resume();
  const completed = new Promise((resolve, reject) => {
    child.on("error", () => reject(new Error("Không chạy được " + name + ". Kiểm tra PG_BIN_DIR hoặc POSTGRES_TOOLS_IMAGE và Docker.")));
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(name + " thất bại (exit " + code + "). Kiểm tra phiên bản client, kết nối và quyền database.")));
  });
  const jobs = [completed];
  if (inputFile) jobs.push(pipeline(fs.createReadStream(inputFile), child.stdin));
  else child.stdin.end();
  if (outputFile) jobs.push(pipeline(child.stdout, fs.createWriteStream(outputFile, { flags: "wx", mode: 0o600 })));
  else child.stdout.resume();
  try { await Promise.all(jobs); }
  catch (error) {
    child.kill();
    await Promise.allSettled(jobs);
    throw error;
  }
}

async function sha256(file) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function sourceUrl() {
  const parsed = connection(process.env.POSTGRES_BACKUP_URL || process.env.POSTGRES_URL);
  // Neon documents direct hostnames as the same endpoint without "-pooler".
  if (parsed.hostname.endsWith(".neon.tech")) parsed.hostname = parsed.hostname.replace(/-pooler(?=\.)/, "");
  else if (/pooler|pgbouncer/i.test(parsed.hostname)) throw new Error("Không dùng transaction pooler để backup. Đặt POSTGRES_BACKUP_URL trực tiếp.");
  return parsed.toString();
}

async function backup(directory) {
  const url = sourceUrl();
  const parsed = connection(url);
  // Kiểm tra tham số kết nối trước khi tạo file.
  pgEnvironment(url, Boolean(process.env.POSTGRES_TOOLS_IMAGE));
  const dir = path.resolve(directory || path.join(ROOT, "backups"));
  await fs.promises.mkdir(dir, { recursive: true });
  const stem = "badminton-" + new Date().toISOString().replace(/[:.]/g, "-") + "-" + crypto.randomBytes(4).toString("hex");
  const archive = path.join(dir, stem + ".dump");
  const manifestFile = archive + ".json";
  const client = await connect(url);
  let success = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL timezone = 'UTC'");
    await client.query("SET LOCAL datestyle = 'ISO, YMD'");
    const snapshot = (await client.query("SELECT pg_export_snapshot() AS snapshot")).rows[0].snapshot;
    const tables = await inventory(client);
    const version = (await client.query("SHOW server_version")).rows[0].server_version;
    await tool("pg_dump", ["--format=custom", "--no-password", "--snapshot=" + snapshot], url, null, archive);
    await client.query("COMMIT");
    const manifest = {
      formatVersion: 1, createdAt: new Date().toISOString(),
      sourceDatabase: decodeURIComponent(parsed.pathname.slice(1)), serverVersion: version,
      archive: path.basename(archive), sha256: await sha256(archive), tables,
    };
    await fs.promises.writeFile(manifestFile, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    success = true;
    console.log(JSON.stringify({ ok: true, archive, manifest: manifestFile, tables: tables.length }));
    return manifest;
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
    if (!success) {
      await fs.promises.unlink(archive).catch(() => {});
      await fs.promises.unlink(manifestFile).catch(() => {});
    }
  }
}

async function readBackup(archivePath) {
  const archive = path.resolve(archivePath);
  const manifest = JSON.parse(await fs.promises.readFile(archive + ".json", "utf8"));
  if (manifest.formatVersion !== 1 || !Array.isArray(manifest.tables) || !manifest.sourceDatabase ||
      manifest.archive !== path.basename(archive) || !/^[a-f0-9]{64}$/.test(manifest.sha256)) {
    throw new Error("Manifest không hợp lệ.");
  }
  if (await sha256(archive) !== manifest.sha256) throw new Error("SHA-256 không khớp; không khôi phục file bị thay đổi.");
  return { archive, manifest };
}

async function restoreOrVerify(archivePath, restore) {
  const { archive, manifest } = await readBackup(archivePath);
  const url = process.env.POSTGRES_RESTORE_URL;
  const targetName = assertRestoreTarget(url, manifest.sourceDatabase);
  if (process.env.POSTGRES_URL) assertRestoreTarget(url, decodeURIComponent(connection(process.env.POSTGRES_URL).pathname.slice(1)));
  if (process.env.POSTGRES_BACKUP_URL) assertRestoreTarget(url, decodeURIComponent(connection(process.env.POSTGRES_BACKUP_URL).pathname.slice(1)));
  const client = await connect(url);
  try {
    const actualName = (await client.query("SELECT current_database() AS name")).rows[0].name;
    if (actualName !== targetName) throw new Error("Database kết nối thực tế không khớp đích yêu cầu.");
    await client.query("SELECT pg_advisory_lock(719513881)");
    if (restore) {
      // Chỉ cho phép DB mới: schema public rỗng và extension mặc định plpgsql.
      const existing = (await client.query(`
        SELECT
          (SELECT count(*) FROM pg_namespace WHERE nspname <> 'public' AND nspname <> 'information_schema' AND nspname !~ '^pg_') +
          (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public') +
          (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public') +
          (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public') +
          (SELECT count(*) FROM pg_extension WHERE extname <> 'plpgsql') AS count
      `)).rows[0].count;
      if (Number(existing) !== 0) throw new Error("Database đích không trống. Không xóa hoặc ghi đè dữ liệu.");
      await tool("pg_restore", ["--dbname=" + targetName, "--no-password", "--no-owner", "--no-privileges", "--single-transaction", "--exit-on-error"], url, archive);
    }
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL timezone = 'UTC'");
    await client.query("SET LOCAL datestyle = 'ISO, YMD'");
    compare(manifest.tables, await inventory(client));
    await client.query("COMMIT");
    const report = { ok: true, action: restore ? "restore-and-verify" : "verify", checkedAt: new Date().toISOString(), archiveSha256: manifest.sha256, tables: manifest.tables.length, targetDatabase: targetName };
    console.log(JSON.stringify(report));
    return report;
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

async function main() {
  const [command, file, ...extra] = process.argv.slice(2);
  if (!command || command === "--help") {
    console.log("backup [thư_mục] | restore <file.dump> | verify <file.dump>\nNguồn: POSTGRES_BACKUP_URL hoặc POSTGRES_URL. Đích: POSTGRES_RESTORE_URL.\nClient: PG_BIN_DIR hoặc POSTGRES_TOOLS_IMAGE=postgres:18. Không nhận URL qua argv.");
    return;
  }
  if (extra.length || !["backup", "restore", "verify"].includes(command)) throw new Error("Tham số không hợp lệ. Chạy --help.");
  if (command === "backup") return backup(file);
  if (!file) throw new Error("Thiếu đường dẫn file.dump.");
  return restoreOrVerify(file, command === "restore");
}

module.exports = { connection, assertRestoreTarget, pgEnvironment, sourceUrl, compare, inventory, backup, restoreOrVerify, sha256 };
if (require.main === module) main().catch((error) => {
  // Không in lỗi kết nối thô chứa credentials.
  const safe = /^(Thiếu|URL|Database|SHA-256|Manifest|Đối chiếu|Không|Tham số|Chứng chỉ|pg_dump|pg_restore)/.test(error.message);
  console.error(safe ? error.message : "Thao tác thất bại. Kiểm tra kết nối, quyền, file và phiên bản công cụ Postgres; không hiển thị lỗi chứa dữ liệu nhạy cảm.");
  process.exitCode = 1;
});
