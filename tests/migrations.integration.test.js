"use strict";
const {test,after} = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const {Pool} = require("pg");
const {databaseOptions} = require("../src/db/connection");
const {loadMigrations,reconcile,runMigrations,migrationStatus,assertMigrationsCurrent} = require("../src/db/migrations");
const {seedDemo} = require("../src/db/seed-demo");

const url=process.env.MONEY_TEST_URL;
if (!url || url !== process.env.POSTGRES_URL) throw new Error("Chạy test bằng runner Docker.");
const parsed=new URL(url);
if(!["localhost","127.0.0.1"].includes(parsed.hostname) || !/^\/badminton_money_test_[a-f0-9]{12}$/.test(parsed.pathname)) throw new Error("Database test không hợp lệ.");
const admin=new Pool(databaseOptions({POSTGRES_URL:url}));
after(()=>admin.end());
async function fixture(t) {
  const name="badminton_money_test_"+crypto.randomBytes(6).toString("hex");
  await admin.query('CREATE DATABASE "'+name+'"');
  const target=new URL(url);target.pathname="/"+name;
  const pool=new Pool(databaseOptions({POSTGRES_URL:target.toString()}));
  t.after(async()=>{
    await pool.end();
    // Tên được tạo tại đây, chỉ trong cluster Docker tạm do runner tạo.
    assert.match(name,/^badminton_money_test_[a-f0-9]{12}$/);
    await admin.query('DROP DATABASE "'+name+'" WITH (FORCE)');
  });
  return pool;
}
test("Startup chỉ đọc trạng thái; database chưa migrate không bị tự tạo bảng",async t=>{
  const pool=await fixture(t);
  await assert.rejects(assertMigrationsCurrent(pool),/db:migrate/);
  assert.equal((await pool.query("SELECT to_regclass('public.schema_migrations') AS name")).rows[0].name,null);
});
test("Database mới migrate đầy đủ, không tự thêm thành viên mẫu",async t=>{
  const pool=await fixture(t);
  assert.equal((await runMigrations(pool)).applied.length,loadMigrations().length);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM members")).rows[0].count,0);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM tournament_events")).rows[0].count,3);
  const client=await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    assert.equal((await assertMigrationsCurrent(client)).pending.length,0);
    await client.query("ROLLBACK");
  }finally{client.release();}
});
test("Chạy migration lặp hoặc đồng thời chỉ ghi mỗi phiên bản một lần",async t=>{
  const pool=await fixture(t);
  const runs=await Promise.all([runMigrations(pool),runMigrations(pool)]);
  assert.equal(runs.reduce((sum,r)=>sum+r.applied.length,0),loadMigrations().length);
  assert.deepEqual((await runMigrations(pool)).applied,[]);
  assert.equal((await migrationStatus(pool)).applied.length,loadMigrations().length);
});
test("Nâng cấp schema cũ giữ nguyên thành viên, công nợ, ngày trả và cấu hình",async t=>{
  const pool=await fixture(t);
  await pool.query(loadMigrations()[0].sql);
  await pool.query(`
    INSERT INTO members(member_id,name) VALUES ('real-member','Thành viên thật');
    INSERT INTO settings(key,value) VALUES ('highThreshold','99');
    INSERT INTO tournament_events(event_id,name,min_level_sum,max_level_sum,gender_rule) VALUES ('MD','Tên đã chỉnh',8,15,'MM');
    INSERT INTO basic_sessions(basic_session_id,play_date,court,total_fee) VALUES ('legacy-session','2026-10-01','Sân cũ',100000);
    INSERT INTO basic_shares(basic_session_id,member_id,member_name,member_name_ci,share_amount,paid,paid_at)
      VALUES ('legacy-session','real-member','Thành viên thật','thành viên thật',100000,TRUE,'2026-10-02T01:00:00Z');
    INSERT INTO member_credits(credit_id,member_id,member_name,amount,note) VALUES ('legacy-credit','real-member','Thành viên thật',50000,'Số dư cũ');
  `);
  const before=(await pool.query("SELECT * FROM basic_shares")).rows;
  await runMigrations(pool);
  assert.deepEqual((await pool.query("SELECT * FROM basic_shares")).rows,before);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM members")).rows[0].count,1);
  assert.equal((await pool.query("SELECT value FROM settings WHERE key='highThreshold'")).rows[0].value,"99");
  assert.equal((await pool.query("SELECT name FROM tournament_events WHERE event_id='MD'")).rows[0].name,"Tên đã chỉnh");
  assert.equal((await pool.query("SELECT amount,request_id FROM member_credits")).rows[0].amount,50000);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM basic_share_settlements")).rows[0].count,0);
});
test("Migration lỗi rollback cả DDL và phiên bản; không để batch dở dang",async t=>{
  const pool=await fixture(t);
  const directory=path.join(__dirname,"fixtures/migration-failure");
  await assert.rejects(runMigrations(pool,{directory}),/SQLSTATE 42P01/);
  const row=(await pool.query("SELECT to_regclass('public.migration_probe') AS probe,to_regclass('public.schema_migrations') AS history")).rows[0];
  assert.equal(row.probe,null);assert.equal(row.history,null);
});
test("Checksum đã áp dụng bị đổi làm startup và migrate từ chối",async t=>{
  const pool=await fixture(t);
  await runMigrations(pool);
  await pool.query("UPDATE schema_migrations SET checksum='changed' WHERE name=$1",[loadMigrations()[0].name]);
  await assert.rejects(assertMigrationsCurrent(pool),/Checksum/);
  await assert.rejects(runMigrations(pool),/Checksum/);
});
test("Không cho thiếu file lịch sử hoặc chèn phiên bản cũ",()=>{
  const migrations=loadMigrations();
  assert.throws(()=>reconcile(migrations,[{name:"9999_missing.sql",checksum:"x"}]),/Thiếu file/);
  assert.throws(()=>reconcile(migrations,[{name:migrations[2].name,checksum:migrations[2].checksum}]),/phiên bản lớn hơn/);
});
test("Seed mẫu chỉ chạy riêng ở dev và không ghi thêm vào danh sách đã có",async t=>{
  const pool=await fixture(t);
  await runMigrations(pool);
  await assert.rejects(seedDemo(pool,{NODE_ENV:"production"}),/production/);
  const seeded=await seedDemo(pool,{NODE_ENV:"development"});
  assert.equal(seeded.membersCreated,7);
  await assert.rejects(seedDemo(pool,{NODE_ENV:"development"}),/trống/);
});
test("Dữ liệu cũ vi phạm khóa ngoại làm migration rollback, không bị xóa hoặc bỏ qua",async t=>{
  const pool=await fixture(t);
  await pool.query(`
    CREATE TABLE birthday_events(event_id TEXT PRIMARY KEY);
    CREATE TABLE birthday_event_brands(id BIGSERIAL PRIMARY KEY,event_id TEXT NOT NULL,brand_name TEXT NOT NULL,sort_order INTEGER NOT NULL DEFAULT 0);
    INSERT INTO birthday_event_brands(event_id,brand_name) VALUES ('orphan','Dữ liệu cũ');
  `);
  await assert.rejects(runMigrations(pool),/SQLSTATE 23503/);
  assert.equal((await pool.query("SELECT brand_name FROM birthday_event_brands")).rows[0].brand_name,"Dữ liệu cũ");
  assert.equal((await pool.query("SELECT to_regclass('public.schema_migrations') AS name")).rows[0].name,null);
});
