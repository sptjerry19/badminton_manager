/* Shared date rules for Node and browsers. All holiday windows come from env. */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ThemeCalendar = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const timeZone = "Asia/Ho_Chi_Minh";
  const definitions = Object.freeze([
    ["halloween", "THEME_HALLOWEEN"],
    ["womens-day", "THEME_WOMENS_DAY"],
    ["teachers-day", "THEME_TEACHERS_DAY"],
    ["mens-day", "THEME_MENS_DAY"],
    ["christmas", "THEME_CHRISTMAS"],
    ["tet", "THEME_TET"],
    ["reunification", "THEME_REUNIFICATION"],
    ["national-day", "THEME_NATIONAL_DAY"],
  ].map(([id, env]) => Object.freeze({ id, env })));
  const ids = new Set(definitions.map(item => item.id));
  const dateFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  });

  function boundary(value) {
    if (typeof value !== "string") throw new Error("Ngày phải là MM-DD hoặc YYYY-MM-DD.");
    const match = /^(?:(\d{4})-)?(\d{2})-(\d{2})$/.exec(value);
    if (!match) throw new Error("Ngày phải là MM-DD hoặc YYYY-MM-DD.");
    const year = match[1] ? Number(match[1]) : 2000;
    const month = Number(match[2]), day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (year < 1000 || date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
      throw new Error("Ngày không tồn tại trong lịch dương.");
    }
    return match[1] ? "dated" : "annual";
  }
  function normalizeRule(rule) {
    if (!rule || !ids.has(rule.id)) throw new Error("Theme trong lịch không hợp lệ.");
    const startKind = boundary(rule.start), endKind = boundary(rule.end);
    if (startKind !== endKind) throw new Error("START và END phải dùng cùng định dạng ngày.");
    if (rule.start === rule.end) throw new Error("START và END phải khác nhau.");
    if (startKind === "dated" && rule.end < rule.start) throw new Error("END phải sau START với ngày đầy đủ.");
    return { id: rule.id, start: rule.start, end: rule.end };
  }
  function normalizeRules(rules) {
    if (!Array.isArray(rules) || rules.length > definitions.length) throw new Error("Danh sách lịch không hợp lệ.");
    const normalized = rules.map(normalizeRule);
    if (new Set(normalized.map(rule => rule.id)).size !== normalized.length) throw new Error("Theme bị lặp trong lịch.");
    return normalized;
  }
  function fromEnvironment(env = {}) {
    const schedules = [], errors = [];
    for (const definition of definitions) {
      const start = String(env[definition.env + "_START"] || "").trim();
      const end = String(env[definition.env + "_END"] || "").trim();
      if (!start && !end) continue; // Both absent: theme is disabled in automatic mode.
      if (!start || !end) {
        errors.push(definition.env + "_START / " + definition.env + "_END: cần điền đủ cả hai mốc.");
        continue;
      }
      try { schedules.push(normalizeRule({ id: definition.id, start, end })); }
      catch (error) { errors.push(definition.env + "_START / " + definition.env + "_END: " + error.message); }
    }
    return { schedules, errors };
  }
  function vietnamDateKey(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error("Thời điểm không hợp lệ.");
    const parts = Object.fromEntries(dateFormatter.formatToParts(date).filter(p => p.type !== "literal").map(p => [p.type, p.value]));
    return parts.year + "-" + parts.month + "-" + parts.day;
  }
  function resolveTheme(rules, value = new Date()) {
    const today = vietnamDateKey(value), md = today.slice(5), year = Number(today.slice(0, 4));
    const candidates = [];
    for (const rule of rules) {
      const annual = rule.start.length === 5;
      let start = rule.start, active;
      if (annual) {
        const wrap = rule.end < rule.start;
        active = wrap ? md >= rule.start || md < rule.end : md >= rule.start && md < rule.end;
        const startYear = year - (wrap && md < rule.start ? 1 : 0);
        start = String(startYear) + "-" + rule.start;
        const end = String(startYear + (wrap ? 1 : 0)) + "-" + rule.end;
        // Recurring Feb 29 windows are inactive when either bound does not exist in that year.
        try { boundary(start); boundary(end); } catch (_) { active = false; }
      } else {
        active = today >= rule.start && today < rule.end;
      }
      if (active) candidates.push({ id: rule.id, start, dated: !annual, order: definitions.findIndex(item => item.id === rule.id) });
    }
    // Most recent start wins. Exact-year overrides win ties, then stable catalog order.
    candidates.sort((a, b) => b.start.localeCompare(a.start) || Number(b.dated) - Number(a.dated) || a.order - b.order);
    return candidates[0]?.id || "default";
  }
  function untilNextDay(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    // Vietnam is UTC+07:00. Date selection itself always uses the IANA zone above.
    const midnight = Date.parse(vietnamDateKey(date) + "T00:00:00+07:00");
    return midnight + 86400000 - date.getTime();
  }
  return Object.freeze({ timeZone, definitions, normalizeRules, fromEnvironment, vietnamDateKey, resolveTheme, untilNextDay });
});
