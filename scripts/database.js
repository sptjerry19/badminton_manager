#!/usr/bin/env node
"use strict";
require("dotenv").config();
const {Pool} = require("pg");
const {databaseOptions} = require("../src/db/connection");
const {runMigrations,migrationStatus,assertMigrationsCurrent} = require("../src/db/migrations");
async function main() {
  const command=process.argv[2],extra=process.argv.slice(3);
  if (!["migrate","status","seed-demo","prune-sessions"].includes(command) ||
      extra.length && !(command==="seed-demo" && extra.length===1 && extra[0]==="--confirm-demo")) {
    throw new Error("Dùng db:migrate, db:status hoặc db:seed-demo -- --confirm-demo.");
  }
  if (command==="seed-demo" && !extra.includes("--confirm-demo")) throw new Error("Seed demo cần --confirm-demo.");
  const pool=new Pool(databaseOptions(process.env,{direct:true}));
  try {
    if(command==="migrate") console.log(JSON.stringify(await runMigrations(pool)));
    else if(command==="status") {
      const status=await migrationStatus(pool);
      console.log(JSON.stringify(status));
      if(status.pending.length) process.exitCode=1;
    } else if(command==="prune-sessions") {
      await assertMigrationsCurrent(pool);
      const result=await pool.query("DELETE FROM login_sessions WHERE expire < NOW()");
      console.log(JSON.stringify({expiredSessionsDeleted:result.rowCount}));
    } else {
      await assertMigrationsCurrent(pool);
      console.log(JSON.stringify(await require("../src/db/seed-demo").seedDemo(pool)));
    }
  } finally {await pool.end();}
}
if(require.main===module) main().catch(error=>{
  // Chỉ các thông báo chủ động của migration/config; lỗi kết nối SQL thô không in.
  const safe=/^(Migration |Checksum |Thiếu file|Database chưa|Không seed|Chỉ seed|Seed demo|Dùng db:|Tên hoặc|Không có migration|URL Postgres|Thiếu POSTGRES|Không cho tắt TLS|Không đọc được chứng chỉ|sslmode|channel_binding)/.test(error.message);
  console.error(safe?error.message:"Lệnh database thất bại. Kiểm tra quyền kết nối trực tiếp, cấu hình TLS và db:status.");
  process.exitCode=1;
});
