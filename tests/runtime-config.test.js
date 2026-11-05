"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {databaseOptions} = require("../src/db/connection");
const {isProduction,validateRuntimeConfig} = require("../src/runtime-config");
const {Client} = require("pg");

const valid = {NODE_ENV:"production",POSTGRES_URL:"postgres://user:private-password@db.example/app?sslmode=require",
  ADMIN_PASSWORD:"separate-admin-password",SESSION_SECRET:"test-session-secret-with-at-least-32-chars",CRON_SECRET:"test-cron-secret-with-at-least-32-chars"};
test("Production yêu cầu secret riêng và không in giá trị vào lỗi",()=>{
  assert.doesNotThrow(()=>validateRuntimeConfig(valid));
  for(const field of ["ADMIN_PASSWORD","SESSION_SECRET","CRON_SECRET"]) {
    const env={...valid};delete env[field];
    assert.throws(()=>validateRuntimeConfig(env),new RegExp(field));
  }
  assert.throws(()=>validateRuntimeConfig({...valid,ADMIN_PASSWORD:"123456",SESSION_SECRET:"badminton-session-secret"}),/ADMIN_PASSWORD.*SESSION_SECRET/);
  assert.throws(()=>validateRuntimeConfig({...valid,NODE_TLS_REJECT_UNAUTHORIZED:"0"}),/TLS/);
  try {validateRuntimeConfig({...valid,CRON_SECRET:"short"});}catch(e){assert.equal(e.message.includes("private-password"),false);}
});
test("Vercel được nhận là production, dev/test vẫn chạy local",()=>{
  assert.equal(isProduction({VERCEL:"1"}),true);
  assert.equal(isProduction({VERCEL:"0"}),false);
  assert.doesNotThrow(()=>validateRuntimeConfig({NODE_ENV:"test",POSTGRES_URL:"postgres://localhost/test"}));
  assert.throws(()=>validateRuntimeConfig({...valid,PORT:"-1"}),/PORT/);
});
test("Postgres từ xa luôn xác minh chứng chỉ, kể cả URL sslmode=require",()=>{
  const options=databaseOptions(valid);
  assert.equal(options.ssl.rejectUnauthorized,true);
  assert.equal(new URL(options.connectionString).searchParams.has("sslmode"),false);
  // Kiểm tra object sau khi pg parse URL, không chỉ object helper.
  const client=new Client(options);
  assert.equal(client.connectionParameters.ssl.rejectUnauthorized,true);
});
test("Không cho sslmode tắt xác minh hoặc giả hostname localhost",()=>{
  assert.throws(()=>databaseOptions({POSTGRES_URL:"postgres://db.example/app?sslmode=disable"}),/TLS/);
  assert.throws(()=>databaseOptions({POSTGRES_URL:"postgres://db.example/app?sslmode=no-verify"}),/sslmode/);
  assert.throws(()=>databaseOptions({POSTGRES_URL:"postgres://db.example/app?ssl=0"}),/ghi đè/);
  assert.throws(()=>databaseOptions({POSTGRES_URL:"postgres://localhost/app?host=db.example"}),/ghi đè/);
  assert.equal(databaseOptions({POSTGRES_URL:"postgres://localhost.attacker.example/app"}).ssl.rejectUnauthorized,true);
  assert.equal(databaseOptions({POSTGRES_URL:"postgres://127.0.0.1:5432/app?sslmode=disable"}).ssl,false);
});
test("Migration dùng endpoint trực tiếp, không đổi URL ứng dụng",()=>{
  const env={POSTGRES_URL:"postgres://u:p@ep-test-pooler.region.neon.tech/app?sslmode=require"};
  const app=databaseOptions(env),migration=databaseOptions(env,{direct:true});
  assert.match(new URL(app.connectionString).hostname,/-pooler/);
  assert.equal(new URL(migration.connectionString).hostname,"ep-test.region.neon.tech");
  assert.match(env.POSTGRES_URL,/-pooler/);
  assert.throws(()=>databaseOptions({POSTGRES_URL:"postgres://other-pooler.example/app"},{direct:true}),/trực tiếp/);
  assert.equal(new URL(databaseOptions({...env,POSTGRES_MIGRATION_URL:"postgres://direct.example/app"},{direct:true}).connectionString).hostname,"direct.example");
});
test("Từ chối URL sai, tham số binding sai hoặc chứng chỉ không đọc được",()=>{
  for(const POSTGRES_URL of ["", "not a url","https://example.com/app","postgres://localhost/"]) assert.throws(()=>databaseOptions({POSTGRES_URL}));
  assert.throws(()=>databaseOptions({POSTGRES_URL:"postgres://db.example/app?channel_binding=wrong"}),/channel_binding/);
  assert.throws(()=>databaseOptions({...valid,POSTGRES_CA_FILE:"file-does-not-exist.pem"}),/chứng chỉ/);
});
