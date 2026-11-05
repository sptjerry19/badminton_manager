"use strict";
// Dùng cùng quy tắc trên Node và trình duyệt, độc lập timezone máy đang chạy.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BusinessTime = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const timeZone = "Asia/Ho_Chi_Minh";
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  });
  function parts(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error("Thời điểm không hợp lệ.");
    return Object.fromEntries(formatter.formatToParts(date).filter(p => p.type !== "literal").map(p => [p.type, p.value]));
  }
  function dateKey(value = new Date()) {
    const p = parts(value);
    return p.year + "-" + p.month + "-" + p.day;
  }
  function dateTimeKey(value = new Date()) {
    const p = parts(value);
    return p.year + "-" + p.month + "-" + p.day + "T" + p.hour + ":" + p.minute;
  }
  function monthKey(value = new Date()) { return dateKey(value).slice(0, 7); }
  return { timeZone, dateKey, dateTimeKey, monthKey };
});
