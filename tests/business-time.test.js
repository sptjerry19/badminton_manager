"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const vm = require("node:vm");
const time = require("../public/business-time");

test("Giờ Việt Nam đổi ngày từ 17:00 UTC, kể cả ranh giới năm", () => {
  assert.equal(time.dateKey("2026-10-31T16:59:59Z"), "2026-10-31");
  assert.equal(time.dateKey("2026-10-31T17:00:00Z"), "2026-11-01");
  assert.equal(time.dateTimeKey("2026-10-31T17:00:00Z"), "2026-11-01T00:00");
  assert.equal(time.monthKey("2026-12-31T17:00:00Z"), "2027-01");
  assert.throws(() => time.dateKey("invalid"), /không hợp lệ/);
});

test("Ngày nghiệp vụ không phụ thuộc múi giờ máy chạy", () => {
  for (const TZ of ["UTC", "America/Los_Angeles", "Pacific/Auckland"]) {
    const output = execFileSync(process.execPath, ["-e",
      'const t=require("./public/business-time");process.stdout.write(t.dateTimeKey("2026-10-31T18:05:00Z"));'],
      {cwd: require("node:path").resolve(__dirname,".."), env:{...process.env,TZ}, encoding:"utf8"});
    assert.equal(output, "2026-11-01T01:05");
  }
});

test("Browser dùng cùng quy tắc timezone như Node", () => {
  const context = {};
  vm.runInNewContext(fs.readFileSync(require.resolve("../public/business-time"),"utf8"), context);
  assert.equal(context.BusinessTime.dateKey("2026-10-31T17:00:00Z"), "2026-11-01");
  assert.equal(context.BusinessTime.dateTimeKey("2026-11-01T00:15:00+07:00"), "2026-11-01T00:15");
});

test("KPI dùng số thu ròng backend và cảnh báo khoản cũ thiếu dữ liệu", () => {
  const source = fs.readFileSync(require.resolve("../public/ledger.js"),"utf8");
  const code = source.slice(source.indexOf("  function paintKpis("),source.indexOf("  function paintTotals("));
  const nodes = new Map();
  const ledger = {ledgerRoot:{},sessions:[{date:"1999-01-01",shares:[{paid:true,shareAmount:999999}]}],
    credits:new Map(), monthlyReport:{month:"2026-11",netCashReceived:-30000,cashReceived:10000,
      cashReversed:40000,creditUsed:20000,creditRestored:0,settlementCount:1,
      legacyPaidCount:2,legacyPaidAmount:70000,undatedLegacyPaidCount:1}};
  const context = {ledger,q:(_root,key)=> {
    if (!nodes.has(key)) nodes.set(key,{textContent:""});
    return nodes.get(key);
  },money:value=>String(value)};
  vm.runInNewContext(code+";paintKpis([]);",context);
  assert.equal(nodes.get("[data-kpi-paid]").textContent,"-30000");
  assert.match(nodes.get("[data-kpi-paid-meta]").textContent,/2 phần cũ/);
  assert.match(nodes.get("[data-kpi-paid-meta]").textContent,/1 phần cũ chưa rõ ngày trả/);
  assert.match(nodes.get("[data-kpi-paid-meta]").textContent,/Dùng tiền dư 20000/);
});
