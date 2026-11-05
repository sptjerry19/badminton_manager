"use strict";
const fs = require("node:fs");

function databaseOptions(env = process.env, {direct = false} = {}) {
  const input = direct ? env.POSTGRES_MIGRATION_URL || env.POSTGRES_URL : env.POSTGRES_URL;
  if (!input) throw new Error("Thiếu POSTGRES_URL.");
  let url;
  try { url = new URL(input); } catch { throw new Error("URL Postgres không hợp lệ."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)) {
    throw new Error("URL Postgres phải có host và tên database.");
  }
  const allowedParameters = new Set(["sslmode","sslrootcert","sslcert","sslkey","uselibpqcompat","channel_binding","application_name","options"]);
  for (const key of url.searchParams.keys()) {
    if (!allowedParameters.has(key)) throw new Error("Tham số ghi đè kết nối trong URL không được hỗ trợ; dùng sslmode và host trong URL chính.");
  }
  if (direct) {
    if (url.hostname.endsWith(".neon.tech")) url.hostname = url.hostname.replace(/-pooler(?=\.)/, "");
    else if (/pooler|pgbouncer/i.test(url.hostname)) throw new Error("Migration cần POSTGRES_MIGRATION_URL kết nối trực tiếp.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
  const mode = url.searchParams.get("sslmode");
  if (mode && !["disable", "require", "verify-full", "verify-ca", "prefer"].includes(mode)) {
    throw new Error("sslmode không được hỗ trợ; dùng verify-full cho Postgres từ xa.");
  }
  if (!local && mode === "disable") throw new Error("Không cho tắt TLS với Postgres từ xa.");
  const binding = url.searchParams.get("channel_binding");
  if (binding && !["disable", "prefer", "require"].includes(binding)) throw new Error("channel_binding không hợp lệ.");
  let ssl = local && (!mode || mode === "disable") ? false : {rejectUnauthorized: true};
  const certFiles = {
    ca: url.searchParams.get("sslrootcert") || env.POSTGRES_CA_FILE,
    cert: url.searchParams.get("sslcert"), key: url.searchParams.get("sslkey"),
  };
  for (const [property, file] of Object.entries(certFiles)) {
    if (file) {
      if (!ssl) throw new Error("Không dùng chứng chỉ khi TLS đang tắt.");
      try { ssl[property] = fs.readFileSync(file, "utf8"); }
      catch { throw new Error("Không đọc được chứng chỉ Postgres; kiểm tra POSTGRES_CA_FILE/sslrootcert/sslcert/sslkey."); }
    }
  }
  // pg có thể để tham số URL ghi đè object ssl; chuẩn hóa ở một chỗ.
  for (const key of ["sslmode", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat", "channel_binding"]) url.searchParams.delete(key);
  return {connectionString:url.toString(),ssl,enableChannelBinding:binding !== "disable",connectionTimeoutMillis:15000};
}
module.exports = {databaseOptions};
