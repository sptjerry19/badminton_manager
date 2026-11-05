"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");
const express = require("express");
const Calendar = require("../public/theme-calendar");
const { createThemeConfigHandler } = require("../src/theme-config");
const rules = [
  { id: "halloween", start: "10-24", end: "11-10" },
  { id: "teachers-day", start: "11-10", end: "12-01" },
];
const select = value => Calendar.resolveTheme(rules, value);

test("Vietnam midnight switches Halloween to Teachers exactly once at the configured boundary", () => {
  assert.equal(select("2026-10-23T16:59:59.999Z"), "default");
  assert.equal(select("2026-10-23T17:00:00.000Z"), "halloween");
  assert.equal(select("2026-11-09T16:59:59.999Z"), "halloween");
  assert.equal(select("2026-11-09T17:00:00.000Z"), "teachers-day");
  assert.equal(select("2026-11-30T16:59:59.999Z"), "teachers-day");
  assert.equal(select("2026-11-30T17:00:00.000Z"), "default");
});
test("Annual windows repeat in another year; Christmas supports crossing New Year", () => {
  const annual = [{ id: "christmas", start: "12-15", end: "01-02" }];
  assert.equal(select("2031-10-23T17:00:00Z"), "halloween");
  assert.equal(Calendar.resolveTheme(annual, "2026-12-14T17:00:00Z"), "christmas");
  assert.equal(Calendar.resolveTheme(annual, "2027-01-01T16:59:59Z"), "christmas");
  assert.equal(Calendar.resolveTheme(annual, "2027-01-01T17:00:00Z"), "default");
  assert.equal(Calendar.resolveTheme(annual, "2026-12-14T16:59:59Z"), "default");
});
test("Full dates allow a Tet window for exactly one year, including cross-year ranges", () => {
  const dated = [{ id: "tet", start: "2026-12-28", end: "2027-02-20" }];
  assert.equal(Calendar.resolveTheme(dated, "2026-12-27T17:00:00Z"), "tet");
  assert.equal(Calendar.resolveTheme(dated, "2027-02-19T17:00:00Z"), "default");
  assert.equal(Calendar.resolveTheme(dated, "2028-01-01T00:00:00Z"), "default");
});
test("Overlaps favor the most recent actual start, including a previous-year annual start", () => {
  const overlap = [
    { id: "christmas", start: "12-15", end: "01-10" },
    { id: "tet", start: "2027-01-01", end: "2027-02-20" },
  ];
  assert.equal(Calendar.resolveTheme(overlap, "2026-12-31T17:00:00Z"), "tet");
  assert.equal(Calendar.resolveTheme(overlap, "2026-12-31T16:59:59Z"), "christmas");
  assert.equal(Calendar.resolveTheme([
    { id: "halloween", start: "10-24", end: "11-15" }, rules[1],
  ], "2026-11-09T17:00:00Z"), "teachers-day");
});
test("Tied starts prefer exact-year rules, then stable theme order regardless of payload order", () => {
  const annual = { id: "halloween", start: "11-10", end: "12-01" };
  const exact = { id: "teachers-day", start: "2026-11-10", end: "2026-12-01" };
  assert.equal(Calendar.resolveTheme([annual, exact], "2026-11-15"), "teachers-day");
  assert.equal(Calendar.resolveTheme([exact, annual], "2026-11-15"), "teachers-day");
  const secondAnnual = { id: "teachers-day", start: "11-10", end: "12-01" };
  assert.equal(Calendar.resolveTheme([secondAnnual, annual], "2026-11-15"), "halloween");
});
test("Leap days are real dates; an annual Feb 29 window does not fire in a non-leap year", () => {
  const leap = Calendar.normalizeRules([{ id: "tet", start: "02-29", end: "03-01" }]);
  assert.equal(Calendar.resolveTheme(leap, "2028-02-28T17:00:00Z"), "tet");
  assert.equal(Calendar.resolveTheme(leap, "2027-02-28T17:00:00Z"), "default");
  const longer = Calendar.normalizeRules([{ id: "tet", start: "02-29", end: "03-10" }]);
  assert.equal(Calendar.resolveTheme(longer, "2027-03-05T00:00:00Z"), "default");
  assert.equal(Calendar.resolveTheme(longer, "2028-03-05T00:00:00Z"), "tet");
  assert.throws(() => Calendar.normalizeRules([{ id: "tet", start: "2027-02-29", end: "2027-03-01" }]));
});
test("Missing both env bounds disables a theme; partial or invalid bounds drop only that theme", () => {
  const parsed = Calendar.fromEnvironment({
    THEME_HALLOWEEN_START: "10-24", THEME_HALLOWEEN_END: "11-10",
    THEME_TEACHERS_DAY_START: "11-10",
    THEME_TET_START: "2027-02-30", THEME_TET_END: "2027-03-01",
  });
  assert.deepEqual(parsed.schedules, [rules[0]]);
  assert.equal(parsed.errors.length, 2);
  assert.deepEqual(Calendar.fromEnvironment({}), { schedules: [], errors: [] });
});
test("Config rejects mixed formats, zero-length ranges, impossible dates, reversed exact dates and unknown IDs", () => {
  for (const pair of [
    ["10-24", "2026-11-10"], ["11-10", "11-10"], ["13-01", "01-02"],
    ["04-31", "05-10"], ["2026-12-01", "2026-11-01"], ["24/10", "10/11"],
  ]) assert.throws(() => Calendar.normalizeRules([{ id: "halloween", start: pair[0], end: pair[1] }]));
  assert.throws(() => Calendar.normalizeRules([{ id: "__proto__", start: "01-01", end: "02-01" }]));
  assert.throws(() => Calendar.normalizeRules([rules[0], rules[0]]));
  assert.throws(() => Calendar.normalizeRules({}));
});
test("The shipped .env.example enables all 8 themes and reproduces the requested November switch", () => {
  const env = require("dotenv").parse(fs.readFileSync(require.resolve("../.env.example")));
  const parsed = Calendar.fromEnvironment(env);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.schedules.length, 8);
  assert.equal(Calendar.resolveTheme(parsed.schedules, "2026-11-09T16:59:59.999Z"), "halloween");
  assert.equal(Calendar.resolveTheme(parsed.schedules, "2026-11-09T17:00:00Z"), "teachers-day");
});
test("Vietnam day and next-midnight delay stay correct at leap-day and year-end boundaries", () => {
  assert.equal(Calendar.vietnamDateKey("2026-12-31T17:00:00Z"), "2027-01-01");
  assert.equal(Calendar.untilNextDay("2026-11-09T16:59:59.999Z"), 1);
  assert.equal(Calendar.untilNextDay("2026-11-09T17:00:00Z"), 86400000);
  assert.equal(Calendar.untilNextDay("2028-02-28T17:00:00Z"), 86400000);
  assert.throws(() => Calendar.vietnamDateKey("not-a-date"));
});
test("Date selection is independent of the host timezone", () => {
  const source = 'const c=require("./public/theme-calendar");process.stdout.write(c.resolveTheme(' + JSON.stringify(rules) + ', "2026-11-09T17:00:00Z"));';
  for (const zone of ["UTC", "America/Los_Angeles", "Asia/Tokyo"]) {
    const result = spawnSync(process.execPath, ["-e", source], { cwd: require("node:path").resolve(__dirname, ".."), env: { ...process.env, TZ: zone }, encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "teachers-day");
  }
});
test("The same calendar engine runs in a browser context", () => {
  const context = {};
  vm.runInNewContext(fs.readFileSync(require.resolve("../public/theme-calendar"), "utf8"), context);
  assert.equal(context.ThemeCalendar.resolveTheme(rules, "2026-11-09T17:00:00Z"), "teachers-day");
});
test("Public endpoint is no-store, independent of login/DB and exposes only safe schedule fields", async t => {
  const env = {
    ADMIN_PASSWORD: "PRIVATE_PASSWORD", POSTGRES_URL: "PRIVATE_DB", SESSION_SECRET: "PRIVATE_SESSION",
    THEME_HALLOWEEN_START: "10-24", THEME_HALLOWEEN_END: "11-10",
  };
  const app = express();
  app.get("/api/theme-config", createThemeConfigHandler({ environment: () => env, now: () => new Date("2026-11-09T17:00:00Z") }));
  app.use(() => { throw new Error("DB/auth middleware must not run"); });
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.on("listening", resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const response = await fetch("http://127.0.0.1:" + server.address().port + "/api/theme-config", { headers: { Cookie: "bgm.sid=not-a-session" } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ["configValid", "schedules", "serverNow", "timeZone", "version"]);
  assert.deepEqual(body.schedules, [rules[0]]);
  assert.equal(body.serverNow, "2026-11-09T17:00:00.000Z");
  assert.equal(body.timeZone, "Asia/Ho_Chi_Minh");
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE_|ADMIN_PASSWORD|POSTGRES_URL|SESSION_SECRET/);
});
test("Endpoint re-reads env and warns once per invalid configuration without logging its values", () => {
  const env = { THEME_HALLOWEEN_START: "PRIVATE_VALUE", THEME_HALLOWEEN_END: "11-10" };
  const warnings = [], responses = [];
  const handler = createThemeConfigHandler({ environment: () => env, logger: { warn: s => warnings.push(s) } });
  const response = { set() {}, json: data => responses.push(data) };
  handler({}, response); handler({}, response);
  assert.equal(warnings.length, 1);
  assert.equal(responses[0].configValid, false);
  assert.deepEqual(responses[0].schedules, []);
  assert.doesNotMatch(warnings.join(), /PRIVATE_VALUE/);
  env.THEME_HALLOWEEN_START = "10-24";
  handler({}, response);
  assert.deepEqual(responses[2].schedules, [rules[0]]);
  assert.equal(responses[2].configValid, true);
});
